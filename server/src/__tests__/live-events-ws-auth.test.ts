import { describe, expect, it, vi } from "vitest";
import { authorizeUpgrade, safeRequestPathForLogs } from "../realtime/live-events-ws.js";

function createDbWithAgentKey(keyRow: { id: string; companyId: string; agentId: string } | null) {
  const whereForSelect = vi.fn().mockResolvedValue(keyRow ? [keyRow] : []);
  const fromForSelect = vi.fn(() => ({ where: whereForSelect }));
  const select = vi.fn(() => ({ from: fromForSelect }));

  const whereForUpdate = vi.fn().mockResolvedValue(undefined);
  const setForUpdate = vi.fn(() => ({ where: whereForUpdate }));
  const update = vi.fn(() => ({ set: setForUpdate }));

  return {
    select,
    update,
    _spies: { whereForSelect, whereForUpdate },
  } as unknown as {
    select: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    _spies: {
      whereForSelect: ReturnType<typeof vi.fn>;
      whereForUpdate: ReturnType<typeof vi.fn>;
    };
  };
}

describe("live websocket upgrade auth hardening", () => {
  it("does not accept token from query string when authorization header is missing", async () => {
    const req = {
      headers: {},
      url: "/api/companies/company-1/events/ws?token=pcp_stolen_in_url",
    } as any;

    const result = await authorizeUpgrade(
      {} as any,
      req,
      "company-1",
      { deploymentMode: "authenticated" },
    );

    expect(result).toBeNull();
  });

  it("accepts a valid bearer token for agent context", async () => {
    const db = createDbWithAgentKey({
      id: "key-1",
      companyId: "company-1",
      agentId: "agent-1",
    });
    const req = {
      headers: {
        authorization: "Bearer pcp_valid_token",
      },
      url: "/api/companies/company-1/events/ws",
    } as any;

    const result = await authorizeUpgrade(
      db as any,
      req,
      "company-1",
      { deploymentMode: "authenticated" },
    );

    expect(result).toEqual({
      companyId: "company-1",
      actorType: "agent",
      actorId: "agent-1",
    });
    expect((db as any)._spies.whereForUpdate).toHaveBeenCalledTimes(1);
  });

  it("removes query string from request path logged on upgrade failures", () => {
    const safePath = safeRequestPathForLogs("/api/companies/company-1/events/ws?token=pcp_secret&x=1");
    expect(safePath).toBe("/api/companies/company-1/events/ws");
  });
});
