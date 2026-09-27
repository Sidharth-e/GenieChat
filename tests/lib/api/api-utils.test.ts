import { describe, it, expect } from "vitest";
import { ApiError, api, handleError, requireAuth, requireService } from "@/lib/api-utils";

describe("ApiError", () => {
  it("stores message, status, and code", () => {
    const err = new ApiError("Oops", 422, "VALIDATION_ERROR");
    expect(err.message).toBe("Oops");
    expect(err.status).toBe(422);
    expect(err.code).toBe("VALIDATION_ERROR");
  });

  it("sets name to ApiError", () => {
    expect(new ApiError("x", 400).name).toBe("ApiError");
  });

  it("is instanceof Error", () => {
    expect(new ApiError("x", 400)).toBeInstanceOf(Error);
  });

  it("code is undefined when not provided", () => {
    expect(new ApiError("x", 400).code).toBeUndefined();
  });
});

describe("api.success", () => {
  it("returns 200 with the provided body", async () => {
    const res = api.success({ ok: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("accepts a custom status code", async () => {
    const res = api.success({ ok: true }, 202);
    expect(res.status).toBe(202);
  });
});

describe("api.created", () => {
  it("returns 201 with the provided body", async () => {
    const res = api.created({ id: "abc" });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "abc" });
  });
});

describe("api.error", () => {
  it("returns the given status with error and code in body", async () => {
    const res = api.error("Something failed", 422, "ERR_VALIDATION");
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("Something failed");
    expect(body.code).toBe("ERR_VALIDATION");
  });

  it("omits code from body when not provided", async () => {
    const res = api.error("oops", 500);
    const body = await res.json();
    expect(body.code).toBeUndefined();
  });
});

describe("api.badRequest", () => {
  it("returns 400 with the provided message", async () => {
    const res = api.badRequest("invalid input");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid input");
  });
});

describe("api.unauthorized", () => {
  it("returns 401 with default message", async () => {
    const res = api.unauthorized();
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Unauthorized");
  });

  it("returns 401 with a custom message", async () => {
    const res = api.unauthorized("Token expired");
    expect((await res.json()).error).toBe("Token expired");
  });
});

describe("api.forbidden", () => {
  it("returns 403 with default message", async () => {
    const res = api.forbidden();
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Forbidden");
  });
});

describe("api.notFound", () => {
  it("returns 404 with generic message when no resource given", async () => {
    const res = api.notFound();
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Not found");
  });

  it("includes the resource name in the message", async () => {
    const res = api.notFound("Thread");
    expect((await res.json()).error).toBe("Thread not found");
  });
});

describe("api.serverError", () => {
  it("returns 500 with default message", async () => {
    const res = api.serverError();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Internal server error");
  });
});

describe("api.tooManyRequests", () => {
  it("returns 429 with no Retry-After header by default", async () => {
    const res = api.tooManyRequests();
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeNull();
  });

  it("sets the Retry-After header when retryAfterSeconds is provided", async () => {
    const res = api.tooManyRequests("slow down", 30);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
  });
});

describe("api.serviceUnavailable", () => {
  it("returns 503 with default message", async () => {
    const res = api.serviceUnavailable();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("Service unavailable");
  });
});

describe("handleError", () => {
  it("maps ApiError to a response with the original status and code", async () => {
    const err = new ApiError("Not allowed", 403, "FORBIDDEN");
    const res = handleError(err, "Test action");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Not allowed");
    expect(body.code).toBe("FORBIDDEN");
  });

  it("maps a generic Error to a 500 response containing the context", async () => {
    const res = handleError(new Error("crash"), "create thread");
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.toLowerCase()).toContain("create thread");
  });

  it("maps an unknown thrown value to a 500 response", async () => {
    const res = handleError("unexpected string error");
    expect(res.status).toBe(500);
  });  it("handles missing context gracefully", async () => {
    const res = handleError(new Error("boom"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("process request");
  });
});

describe("requireAuth", () => {
  it("returns true for a truthy value", () => {
    expect(requireAuth({ id: "u1" })).toBe(true);
  });

  it("returns false for null", () => {
    expect(requireAuth(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(requireAuth(undefined)).toBe(false);
  });
});

describe("requireService", () => {
  it("returns true for a non-null service", () => {
    expect(requireService("db-client")).toBe(true);
  });

  it("returns false for null", () => {
    expect(requireService(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(requireService(undefined)).toBe(false);
  });
});
