import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DatasetsView } from "./DatasetsView";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const dataset = {
  dataset_id: "ds_regression",
  name: "RAG regression",
  description: "reviewed failures",
  revision: 1,
  example_count: 1,
  created_at: "2026-07-28T10:00:00.000000Z",
  updated_at: "2026-07-28T10:00:00.000000Z",
  examples: [
    {
      dataset_example_id: "dse_1",
      position: 0,
      input: { question: "지원 대상은?" },
      expected_output: { answer: "청년" },
      metadata: {},
      source_trace_id: "tr_reviewed",
      created_at: "2026-07-28T10:00:00.000000Z",
      updated_at: "2026-07-28T10:00:00.000000Z",
    },
  ],
};

const emptiedDataset = {
  ...dataset,
  revision: 2,
  example_count: 0,
  examples: [],
};

const experiment = {
  experiment_id: "exp_1",
  dataset_id: "ds_regression",
  dataset_revision: 1,
  name: "baseline",
  status: "completed",
  started_at: "2026-07-28T11:00:00.000000Z",
  ended_at: "2026-07-28T11:00:09.000000Z",
  case_count: 1,
  completed_case_count: 1,
  failed_case_count: 0,
};

function mockLists(
  fetchMock: ReturnType<typeof vi.fn<typeof fetch>>,
  options: {
    datasets?: unknown[];
    experiments?: unknown[];
    detail?: () => unknown;
    onMutate?: (method: string, url: string) => Response | null;
  } = {},
) {
  const {
    datasets = [dataset],
    experiments = [experiment],
    detail = () => dataset,
    onMutate,
  } = options;
  fetchMock.mockImplementation((input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (method !== "GET" && onMutate !== undefined) {
      const response = onMutate(method, url);
      if (response !== null) {
        return Promise.resolve(response);
      }
    }
    if (url.endsWith("/datasets")) {
      return Promise.resolve(jsonResponse({ items: datasets }));
    }
    if (url.endsWith("/experiments")) {
      return Promise.resolve(jsonResponse({ items: experiments }));
    }
    if (url.endsWith("/datasets/ds_regression")) {
      return Promise.resolve(jsonResponse(detail()));
    }
    return Promise.reject(new Error(`unexpected request: ${url}`));
  });
}

describe("DatasetsView", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("lists datasets with their example and experiment counts", async () => {
    mockLists(fetchMock);

    render(<DatasetsView />);

    const row = (
      await screen.findByRole("button", { name: "RAG regression" })
    ).closest("tr") as HTMLElement;
    expect(within(row).getByText("reviewed failures")).toBeInTheDocument();
    // 1 experiment, 1 example.
    expect(within(row).getAllByText("1")).toHaveLength(2);
    // The detail request only fires once a dataset is opened.
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/v1/datasets/ds_regression",
      expect.any(Object),
    );
  });

  it("opens a dataset and hides example creation behind a button", async () => {
    mockLists(fetchMock);

    render(<DatasetsView />);
    await userEvent.click(
      await screen.findByRole("button", { name: "RAG regression" }),
    );

    expect(
      await screen.findByRole("heading", { level: 1, name: "RAG regression" }),
    ).toBeInTheDocument();
    expect(screen.getByText("revision 1")).toBeInTheDocument();
    expect(screen.queryByLabelText("Input")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Add example" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("Input")).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Expected output은 의도적으로 비워 둘 수 있습니다.",
      ),
    ).toBeInTheDocument();
  });

  it("shows the dataset's experiments on the experiments tab", async () => {
    mockLists(fetchMock);

    render(<DatasetsView />);
    await userEvent.click(
      await screen.findByRole("button", { name: "RAG regression" }),
    );
    await userEvent.click(
      await screen.findByRole("tab", { name: "Experiments (1)" }),
    );

    expect(
      screen.getByRole("button", { name: "baseline" }),
    ).toBeInTheDocument();
    expect(screen.getByText("rev 1")).toBeInTheDocument();
    expect(screen.getByText("1/1 · 0 failed")).toBeInTheDocument();
  });

  it("deletes an example and reloads the revised dataset", async () => {
    let deleted = false;
    mockLists(fetchMock, {
      detail: () => (deleted ? emptiedDataset : dataset),
      onMutate: (method, url) => {
        if (
          method === "DELETE" &&
          url.endsWith("/datasets/ds_regression/examples/dse_1")
        ) {
          deleted = true;
          return new Response(null, { status: 204 });
        }
        return null;
      },
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<DatasetsView />);
    await userEvent.click(
      await screen.findByRole("button", { name: "RAG regression" }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Example 1 actions" }),
    );
    await userEvent.click(screen.getByRole("menuitem", { name: "영구 삭제" }));

    expect(
      await screen.findByText("아직 example이 없습니다."),
    ).toBeInTheDocument();
    expect(screen.getByText("revision 2")).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Examples (0)" }),
    ).toBeInTheDocument();
  });

  it("explains why a dataset with experiment history cannot be deleted", async () => {
    mockLists(fetchMock, {
      onMutate: (method) =>
        method === "DELETE"
          ? jsonResponse({ detail: "experiment history" }, 409)
          : null,
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<DatasetsView />);
    await userEvent.click(
      await screen.findByRole("button", { name: "RAG regression actions" }),
    );
    await userEvent.click(screen.getByRole("menuitem", { name: "영구 삭제" }));

    const blocked = await screen.findByText(
      "Experiment 기록이 있는 dataset은 삭제할 수 없습니다.",
    );
    // A blocked delete must not be announced like a completed one.
    expect(blocked).toHaveAttribute("role", "alert");
    expect(blocked).toHaveAttribute("data-tone", "error");
    expect(
      screen.getByRole("button", { name: "RAG regression" }),
    ).toBeInTheDocument();
  });

  it("removes a deleted dataset from the list", async () => {
    mockLists(fetchMock, {
      onMutate: (method) =>
        method === "DELETE" ? new Response(null, { status: 204 }) : null,
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<DatasetsView />);
    await userEvent.click(
      await screen.findByRole("button", { name: "RAG regression actions" }),
    );
    await userEvent.click(screen.getByRole("menuitem", { name: "영구 삭제" }));

    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "RAG regression" }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByText("아직 Dataset이 없습니다.")).toBeInTheDocument();
    expect(screen.getByText("Dataset을 삭제했습니다.")).toHaveAttribute(
      "data-tone",
      "info",
    );
  });
});
