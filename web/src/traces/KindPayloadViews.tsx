import type {JsonValue, Observation} from "../api/types";
import {useT} from "../i18n/context";
import {
  readLlmCompletion,
  readLlmMessages,
  readTokenUsage,
  readToolArguments,
  readToolResult,
  toolSignature,
} from "./payloadShapes";
import {JsonSection} from "./PrettyJson";

const ROLE_LABEL: Record<string, string> = {
  system: "System",
  human: "Human",
  ai: "AI",
  tool: "Tool",
};

/** llm 실행: prompt를 역할별로 나눠 보여주고 응답과 token 수를 함께 둔다. */
export function LlmView({observation}: {observation: Observation}) {
  const t = useT();
  const messages = readLlmMessages(observation.input);
  const completion = readLlmCompletion(observation.output);
  const usage = readTokenUsage(observation.usage);

  return (
    <section className="kind-view" aria-label={t("LLM 호출")}>
      {usage !== null ? (
        <p className="kind-usage">
          {observation.model !== null ? (
            <span className="kind-model">{observation.model}</span>
          ) : null}
          {usage.input !== null ? <span>input {usage.input}</span> : null}
          {usage.output !== null ? <span>output {usage.output}</span> : null}
          {usage.total !== null ? <span>total {usage.total}</span> : null}
        </p>
      ) : null}
      <ol className="message-list">
        {messages.map((message, index) => (
          <li className="message" data-role={message.role} key={index}>
            <span className="message-role">
              {ROLE_LABEL[message.role] ?? message.role}
            </span>
            <p className="message-content">{message.content}</p>
          </li>
        ))}
      </ol>
      {completion !== null ? (
        <div className="message" data-role="completion">
          <span className="message-role">{t("응답")}</span>
          <p className="message-content">{completion}</p>
        </div>
      ) : null}
    </section>
  );
}

/** tool 실행: 호출을 시그니처 한 줄로, 반환값을 그 아래에. */
export function ToolView({observation}: {observation: Observation}) {
  const t = useT();
  const args = readToolArguments(observation.input);
  const result: JsonValue = readToolResult(observation.output);

  return (
    <section className="kind-view" aria-label={t("Tool 호출")}>
      <code className="tool-signature">
        {toolSignature(observation.name, args)}
      </code>
      <JsonSection title={t("반환값")} value={result} />
    </section>
  );
}
