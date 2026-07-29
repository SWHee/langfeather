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

const secondDataset = {
  ...dataset,
  dataset_id: "ds_prompt_checks",
  name: "Prompt checks",
  description: "prompt-only cases",
  revision: 4,
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
    detail?: (datasetId: string) => unknown;
    onMutate?: (method: string, url: string) => Response | null;
  } = {},
) {
  const {
    datasets = [dataset],
    experiments = [experiment],
    detail = (datasetId) =>
      datasetId === secondDataset.dataset_id ? secondDataset : dataset,
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
    const detailMatch = url.match(/\/datasets\/([^/?]+)$/);
    if (detailMatch?.[1] !== undefined) {
      return Promise.resolve(
        jsonResponse(detail(decodeURIComponent(detailMatch[1]))),
      );
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

  it("selects the first dataset and opens Compare by default", async () => {
    mockLists(fetchMock);

    render(<DatasetsView />);

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Datasets & Experiments",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Dataset 선택" }),
    ).toHaveValue("ds_regression");
    expect(screen.getByText("revision 1")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Compare" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    expect(
      await screen.findByText("Experiment가 1개뿐이라 비교할 수 없습니다."),
    ).toBeInTheDocument();
  });

  it("removes a dataset whose detail was deleted and selects the first remaining dataset", async () => {
    let datasetListCalls = 0;
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/datasets")) {
        datasetListCalls += 1;
        return Promise.resolve(
          jsonResponse({
            items:
              datasetListCalls === 1 ? [dataset, secondDataset] : [secondDataset],
          }),
        );
      }
      if (url.endsWith("/experiments")) {
        return Promise.resolve(jsonResponse({ items: [] }));
      }
      if (url.endsWith(`/datasets/${dataset.dataset_id}`)) {
        return Promise.resolve(jsonResponse({ detail: "not found" }, 404));
      }
      if (url.endsWith(`/datasets/${secondDataset.dataset_id}`)) {
        return Promise.resolve(jsonResponse(secondDataset));
      }
      return Promise.reject(new Error(`unexpected request: ${url}`));
    });

    render(<DatasetsView />);

    expect(
      await screen.findByText("이 Dataset은 삭제되었습니다."),
    ).toHaveAttribute("data-tone", "info");
    expect(datasetListCalls).toBe(2);
    expect(
      screen.queryByRole("option", { name: "RAG regression" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Dataset 선택" }),
    ).toHaveValue(secondDataset.dataset_id);
    expect(
      await screen.findByRole("heading", { level: 2, name: "Prompt checks" }),
    ).toBeInTheDocument();
  });

  it("switches every tab to the selected dataset context", async () => {
    const user = userEvent.setup();
    mockLists(fetchMock, {
      datasets: [dataset, secondDataset],
    });

    render(<DatasetsView />);
    const selector = await screen.findByRole("combobox", {
      name: "Dataset 선택",
    });

    await user.selectOptions(selector, "ds_prompt_checks");

    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: "Prompt checks",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("revision 4")).toBeInTheDocument();

    const compareTab = screen.getByRole("tab", { name: "Compare" });
    compareTab.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Experiments (0)" })).toHaveFocus();
    expect(
      screen.getByText("아직 experiment가 없습니다."),
    ).toBeInTheDocument();

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Examples (0)" })).toHaveFocus();
    expect(screen.getByText("아직 example이 없습니다.")).toBeInTheDocument();
  });

  it("filters dataset options by name and description", async () => {
    const user = userEvent.setup();
    mockLists(fetchMock, { datasets: [dataset, secondDataset] });

    render(<DatasetsView />);

    const search = await screen.findByRole("textbox", {
      name: "Dataset 검색",
    });
    await user.type(search, "PROMPT-ONLY");

    expect(
      screen.getByRole("option", { name: "Prompt checks" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "RAG regression" }),
    ).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "rag regression");

    expect(
      screen.getByRole("option", { name: "RAG regression" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "Prompt checks" }),
    ).not.toBeInTheDocument();
  });

  it("hides example creation behind a button", async () => {
    mockLists(fetchMock);

    render(<DatasetsView />);
    await screen.findByRole("heading", { level: 2, name: "RAG regression" });

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

  it("renders loading, empty, and API failure states", async () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => undefined));
    const loadingView = render(<DatasetsView />);

    expect(
      screen.getByText("Evaluation 데이터를 불러오는 중…"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Dataset 선택" }),
    ).toBeDisabled();

    loadingView.unmount();
    fetchMock.mockReset();
    mockLists(fetchMock, { datasets: [], experiments: [] });
    const emptyView = render(<DatasetsView />);

    expect(await screen.findByText("아직 Dataset이 없습니다.")).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Dataset 선택" }),
    ).toBeDisabled();

    emptyView.unmount();
    fetchMock.mockReset();
    fetchMock.mockRejectedValue(new Error("offline"));
    render(<DatasetsView />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Evaluation 데이터를 불러오지 못했습니다.",
    );
  });

  it("shows the dataset's experiments on the experiments tab", async () => {
    mockLists(fetchMock);

    render(<DatasetsView />);
    await screen.findByRole("heading", { level: 2, name: "RAG regression" });
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
      await screen.findByRole("tab", { name: "Examples (1)" }),
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
      screen.getByRole("option", { name: "RAG regression" }),
    ).toBeInTheDocument();
  });

  it("removes a deleted dataset from the workspace", async () => {
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
        screen.queryByRole("option", { name: "RAG regression" }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByText("아직 Dataset이 없습니다.")).toBeInTheDocument();
    expect(screen.getByText("Dataset을 삭제했습니다.")).toHaveAttribute(
      "data-tone",
      "info",
    );
  });

  it("keeps the newly selected dataset when a slower mutation refetch resolves late", async () => {
    const user = userEvent.setup();
    const stale: { release?: () => void } = {};
    let exampleDeleted = false;
    mockLists(fetchMock, {
      datasets: [dataset, secondDataset],
      onMutate: (method) => {
        if (method !== "DELETE") {
          return null;
        }
        exampleDeleted = true;
        return new Response(null, { status: 204 });
      },
    });
    const baseMock = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (
        (init?.method ?? "GET") === "GET" &&
        url.endsWith(`/datasets/${dataset.dataset_id}`) &&
        exampleDeleted &&
        stale.release === undefined
      ) {
        return new Promise<Response>((resolve) => {
          stale.release = () =>
            resolve(jsonResponse({ ...dataset, revision: 9 }));
        });
      }
      return baseMock(input, init);
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<DatasetsView />);
    await user.click(await screen.findByRole("tab", { name: /Examples/ }));
    await user.click(
      await screen.findByRole("button", { name: "Example 1 actions" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "영구 삭제" }));

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Dataset 선택" }),
      secondDataset.dataset_id,
    );
    await waitFor(() =>
      expect(screen.getByText("revision 4")).toBeInTheDocument(),
    );

    stale.release?.();

    await waitFor(() =>
      expect(screen.getByText("revision 4")).toBeInTheDocument(),
    );
    expect(screen.queryByText("revision 9")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Dataset 세부 정보를 불러오는 중…"),
    ).not.toBeInTheDocument();
  });
});
