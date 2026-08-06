import { useRef, useState } from "react";

import { downloadBackup, resetAllData } from "../api/client";
import { Modal } from "../components";
import { useT } from "../i18n/context";

/** 오류 여부를 문구로 판정하지 않는다. 언어가 바뀌면 문구가 바뀐다. */
type Status = { text: string; error: boolean } | null;

export function LocalDataView({ onReset }: { onReset: () => void }) {
  const t = useT();
  const [confirmation, setConfirmation] = useState("");
  const [dialog, setDialog] = useState(false);
  const [backupStatus, setBackupStatus] = useState<Status>(null);
  const [resetStatus, setResetStatus] = useState<Status>(null);
  const [backupPending, setBackupPending] = useState(false);
  const [resetPending, setResetPending] = useState(false);
  const resetButton = useRef<HTMLButtonElement>(null);

  const backup = async () => {
    setBackupPending(true);
    setBackupStatus(null);
    try {
      await downloadBackup();
      setBackupStatus({
        text: t("SQLite 백업을 다운로드했습니다."),
        error: false,
      });
    } catch {
      setBackupStatus({
        text: t("SQLite 백업을 다운로드하지 못했습니다."),
        error: true,
      });
    } finally {
      setBackupPending(false);
    }
  };
  const reset = async () => {
    setResetPending(true);
    setResetStatus(null);
    try {
      await resetAllData();
      setDialog(false);
      setConfirmation("");
      setResetStatus({
        text: t("로컬 데이터를 초기화했습니다. 빈 Trace 목록으로 이동합니다."),
        error: false,
      });
      onReset();
    } catch {
      setResetStatus({
        text: t("로컬 데이터를 초기화하지 못했습니다. 데이터는 유지됩니다."),
        error: true,
      });
    } finally {
      setResetPending(false);
    }
  };

  return (
    <main className="page settings-page" id="lf-main" tabIndex={-1}>
      <h1>{t("설정")}</h1>
      <section className="settings-section" aria-labelledby="backupTitle">
        <h2 id="backupTitle">{t("백업")}</h2>
        <article className="settings-card">
          <div>
            <h3>{t("SQLite 백업")}</h3>
            <p>{t("현재 데이터베이스를 다운로드합니다.")}</p>
          </div>
          <button
            className="lf-btn is-primary"
            type="button"
            disabled={backupPending}
            onClick={() => void backup()}
          >
            {backupPending ? t("다운로드 중…") : t("백업 다운로드")}
          </button>
        </article>
        <p
          className={`settings-status${backupStatus?.error ? " is-error" : ""}`}
          role="status"
        >
          {backupStatus?.text ?? ""}
        </p>
      </section>
      <section className="settings-section" aria-labelledby="resetTitle">
        <h2 id="resetTitle">{t("초기화")}</h2>
        <article className="settings-card reset-card">
          <div className="reset-head">
            <div>
              <h3>{t("로컬 데이터 초기화")}</h3>
              <p>
                {t(
                  "모든 traces, observations, annotations, queues, scores와 datasets가 삭제됩니다.",
                )}
              </p>
            </div>
          </div>
          <div className="reset-form">
            <label className="reset-field">
              {t("계속하려면 RESET 입력")}
              <input
                autoComplete="off"
                spellCheck="false"
                value={confirmation}
                placeholder="RESET"
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </label>
            <button
              className="lf-btn is-danger"
              ref={resetButton}
              type="button"
              disabled={confirmation !== "RESET"}
              onClick={() => setDialog(true)}
            >
              {t("초기화")}
            </button>
          </div>
          <p
            className={`settings-status${resetStatus?.error ? " is-error" : ""}`}
            role="status"
          >
            {resetStatus?.text ?? ""}
          </p>
        </article>
      </section>
      <Modal
        open={dialog}
        title={t("로컬 데이터를 초기화할까요?")}
        onClose={() => {
          if (!resetPending) {
            setDialog(false);
            resetButton.current?.focus();
          }
        }}
      >
        <div className="lf-modal-body">
          <p className="modal-copy">
            {t(
              "이 작업은 되돌릴 수 없습니다. 초기화 후 빈 Trace 목록으로 이동합니다.",
            )}
          </p>
          <div className="modal-actions">
            <button
              className="lf-btn"
              type="button"
              disabled={resetPending}
              onClick={() => {
                setDialog(false);
                resetButton.current?.focus();
              }}
            >
              {t("취소")}
            </button>
            <button
              className="lf-btn is-danger"
              type="button"
              disabled={resetPending}
              onClick={() => void reset()}
            >
              {resetPending ? t("초기화 중…") : t("초기화")}
            </button>
          </div>
        </div>
      </Modal>
    </main>
  );
}
