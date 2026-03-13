import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentRoutes } from "../routes/agents.js";

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
  listKeys: vi.fn(),
  createApiKey: vi.fn(),
  revokeKey: vi.fn(),
  resolveByReference: vi.fn(),
}));

vi.mock("../services/index.js", () => ({
  agentService: () => mockAgentService,
  accessService: () => ({
    canUser: vi.fn(),
    hasPermission: vi.fn(),
  }),
  approvalService: () => ({
    create: vi.fn(),
    getById: vi.fn(),
  }),
  heartbeatService: () => ({
    wakeup: vi.fn(),
  }),
  issueApprovalService: () => ({
    linkManyForApproval: vi.fn(),
  }),
  issueService: () => ({
    getById: vi.fn(),
  }),
  secretService: () => ({
    normalizeAdapterConfigForPersistence: vi.fn(),
    resolveAdapterConfigForRuntime: vi.fn(),
    normalizeHireApprovalPayloadForPersistence: vi.fn(),
  }),
  logActivity: vi.fn(),
}));

const AGENT_ID = "11111111-1111-4111-8111-111111111111";
const DENIED_COMPANY_ID = "company-denied";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = {
      type: "board",
      userId: "board-user",
      source: "session",
      isInstanceAdmin: false,
      companyIds: ["company-allowed"],
    };
    next();
  });
  app.use("/api", agentRoutes({} as any));
  return app;
}

describe("agent key routes company scoping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAgentService.getById.mockResolvedValue({
      id: AGENT_ID,
      companyId: DENIED_COMPANY_ID,
      status: "idle",
    });
    mockAgentService.listKeys.mockResolvedValue([]);
    mockAgentService.createApiKey.mockResolvedValue({
      id: "key-1",
      name: "default",
      token: "pcp_test_token",
      createdAt: new Date("2026-03-13T10:00:00.000Z"),
    });
    mockAgentService.revokeKey.mockResolvedValue({
      id: "key-1",
      revokedAt: new Date("2026-03-13T10:00:00.000Z"),
    });
  });

  it("refuses listing keys when board user has no access to target company", async () => {
    const app = createApp();
    const res = await request(app).get(`/api/agents/${AGENT_ID}/keys`);

    expect(res.status).toBe(403);
    expect(mockAgentService.listKeys).not.toHaveBeenCalled();
  });

  it("refuses creating keys when board user has no access to target company", async () => {
    const app = createApp();
    const res = await request(app)
      .post(`/api/agents/${AGENT_ID}/keys`)
      .send({ name: "production" });

    expect(res.status).toBe(403);
    expect(mockAgentService.createApiKey).not.toHaveBeenCalled();
  });

  it("refuses revoking keys when board user has no access to target company", async () => {
    const app = createApp();
    const res = await request(app).delete(`/api/agents/${AGENT_ID}/keys/key-1`);

    expect(res.status).toBe(403);
    expect(mockAgentService.revokeKey).not.toHaveBeenCalled();
  });
});
