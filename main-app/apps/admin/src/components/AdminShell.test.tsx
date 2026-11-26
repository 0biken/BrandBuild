import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AdminShell } from "./AdminShell";

const replace = vi.fn();
const push = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/staff",
  useRouter: () => ({ replace, push }),
}));

describe("AdminShell", () => {
  it("renders all seven admin navigation tabs when authenticated", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: "00000000-0000-0000-0000-000000000001",
            email: "femi@brandbuild.co",
            displayName: "Femi",
            roles: ["staff_admin"],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    render(
      <AdminShell>{(staff) => <div>Hello {staff.displayName}</div>}</AdminShell>,
    );

    await waitFor(() => {
      expect(screen.getByText("Hello Femi")).toBeTruthy();
    });

    for (const label of [
      "Overview",
      "Workspaces",
      "Outcome unclear",
      "Student reviews",
      "AI spend",
      "Audit log",
      "Staff & Access",
    ]) {
      expect(screen.getByRole("link", { name: label })).toBeTruthy();
    }
    expect(screen.getByText("Femi · Staff admin")).toBeTruthy();
  });

  it("redirects to /login on 401", async () => {
    replace.mockClear();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: "unauthorized" } }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(<AdminShell>{() => <div>Protected</div>}</AdminShell>);

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith("/login");
    });
  });
});
