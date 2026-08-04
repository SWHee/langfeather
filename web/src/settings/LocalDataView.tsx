import { useRef, useState } from "react";

import { downloadBackup, resetAllData } from "../api/client";
import { Modal } from "../components";

export function LocalDataView({ onReset }: { onReset: () => void }) {
  const [confirmation, setConfirmation] = useState("");
  const [dialog, setDialog] = useState(false);
  const [backupStatus, setBackupStatus] = useState("");
  const [resetStatus, setResetStatus] = useState("");
  const [backupPending, setBackupPending] = useState(false);
  const [resetPending, setResetPending] = useState(false);
  const resetButton = useRef<HTMLButtonElement>(null);

  const backup = async () => {
    setBackupPending(true);
    setBackupStatus("");
    try {
      await downloadBackup();
      setBackupStatus("SQLite 백업을 다운로드했습니다.");
    } catch {
      setBackupStatus("SQLite 백업을 다운로드하지 못했습니다.");
    } finally {
      setBackupPending(false);
    }
  };
  const reset = async () => {
    setResetPending(true);
    setResetStatus("");
    try {
      await resetAllData();
      setDialog(false);
      setConfirmation("");
      setResetStatus(
        "로컬 데이터를 초기화했습니다. 빈 Trace 목록으로 이동합니다.",
      );
      onReset();
    } catch {
      setResetStatus(
        "로컬 데이터를 초기화하지 못했습니다. 데이터는 유지됩니다.",
      );
    } finally {
      setResetPending(false);
    }
  };

  return (
    <main className="page settings-page" id="lf-main" tabIndex={-1}>
      <h1>설정</h1>
      <section className="settings-section" aria-labelledby="backupTitle">
        <h2 id="backupTitle">백업</h2>
        <article className="settings-card">
          <div>
            <h3>SQLite 백업</h3>
            <p>현재 데이터베이스를 다운로드합니다.</p>
          </div>
          <button
            className="lf-btn is-primary"
            type="button"
            disabled={backupPending}
            onClick={() => void backup()}
          >
            {backupPending ? "다운로드 중…" : "백업 다운로드"}
          </button>
        </article>
        <p
          className={`settings-status${backupStatus.includes("못") ? " is-error" : ""}`}
          role="status"
        >
          {backupStatus}
        </p>
      </section>
      <section className="settings-section" aria-labelledby="resetTitle">
        <h2 id="resetTitle">초기화</h2>
        <article className="settings-card reset-card">
          <div className="reset-head">
            <div>
              <h3>로컬 데이터 초기화</h3>
              <p>
                모든 traces, observations, annotations, queues, scores와
                datasets가 삭제됩니다.
              </p>
            </div>
          </div>
          <div className="reset-form">
            <label className="reset-field">
              계속하려면 RESET 입력
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
              초기화
            </button>
          </div>
          <p
            className={`settings-status${resetStatus.includes("못") ? " is-error" : ""}`}
            role="status"
          >
            {resetStatus}
          </p>
        </article>
      </section>
      <Modal
        open={dialog}
        title="로컬 데이터를 초기화할까요?"
        onClose={() => {
          if (!resetPending) {
            setDialog(false);
            resetButton.current?.focus();
          }
        }}
      >
        <div className="lf-modal-body">
          <p className="modal-copy">
            이 작업은 되돌릴 수 없습니다. 초기화 후 빈 Trace 목록으로
            이동합니다.
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
              취소
            </button>
            <button
              className="lf-btn is-danger"
              type="button"
              disabled={resetPending}
              onClick={() => void reset()}
            >
              {resetPending ? "초기화 중…" : "초기화"}
            </button>
          </div>
        </div>
      </Modal>
    </main>
  );
}
