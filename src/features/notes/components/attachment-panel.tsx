"use client";

import {
  AlertTriangle,
  Download,
  File,
  FileImage,
  LoaderCircle,
  Paperclip,
  RefreshCcw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import type {
  ApiError,
  AttachmentItem,
  AttachmentsPage,
  NoteDetail,
} from "../types";

export type AttachmentPanelHandle = {
  uploadFiles: (files: File[]) => Promise<void>;
};

type AttachmentPanelProps = {
  noteId: string;
  uploadDisabled: boolean;
  beforeMutation: () => Promise<boolean>;
  getExpectedVersion: () => number;
  onNoteChanged: (note: NoteDetail) => void;
};

type UploadItem = {
  key: string;
  file: File;
  progress: number;
  state: "uploading" | "failed";
  error: string | null;
};

export const AttachmentPanel = forwardRef<
  AttachmentPanelHandle,
  AttachmentPanelProps
>(function AttachmentPanel(
  { noteId, uploadDisabled, beforeMutation, getExpectedVersion, onNoteChanged },
  ref,
) {
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);
  const [removePending, setRemovePending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestsRef = useRef(new Map<string, XMLHttpRequest>());

  const load = useCallback(
    async (cursor?: string) => {
      if (cursor) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const query = new URLSearchParams({ limit: "100" });
        if (cursor) query.set("cursor", cursor);
        const response = await fetch(
          `/api/notes/${noteId}/attachments?${query}`,
          { cache: "no-store" },
        );
        const payload = (await response.json()) as AttachmentsPage | ApiError;
        if (!response.ok || "error" in payload) {
          throw new Error(
            "error" in payload
              ? payload.error.message
              : "Attachments could not be loaded",
          );
        }
        setAttachments((current) =>
          cursor ? [...current, ...payload.items] : payload.items,
        );
        setNextCursor(payload.nextCursor);
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Attachments could not be loaded",
        );
      } finally {
        if (cursor) setLoadingMore(false);
        else setLoading(false);
      }
    },
    [noteId],
  );

  useEffect(() => {
    let active = true;
    const requests = requestsRef.current;
    queueMicrotask(() => {
      if (active) void load();
    });
    return () => {
      active = false;
      for (const request of requests.values()) request.abort();
      requests.clear();
    };
  }, [load]);

  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (uploadDisabled || files.length === 0) return;
      if (!(await beforeMutation())) return;
      for (const file of files) {
        const key = crypto.randomUUID();
        setUploads((current) => [
          ...current,
          { key, file, progress: 0, state: "uploading", error: null },
        ]);
        try {
          const result = await uploadOne(
            noteId,
            file,
            getExpectedVersion(),
            (progress) =>
              setUploads((current) =>
                current.map((item) =>
                  item.key === key ? { ...item, progress } : item,
                ),
              ),
            (request) => requestsRef.current.set(key, request),
          );
          requestsRef.current.delete(key);
          setUploads((current) => current.filter((item) => item.key !== key));
          setAttachments((current) => [
            result.attachment,
            ...current.filter(({ id }) => id !== result.attachment.id),
          ]);
          onNoteChanged(result.note);
        } catch (uploadError) {
          requestsRef.current.delete(key);
          const message =
            uploadError instanceof Error
              ? uploadError.message
              : "The upload failed";
          if (message === "Upload cancelled") {
            setUploads((current) => current.filter((item) => item.key !== key));
          } else {
            setUploads((current) =>
              current.map((item) =>
                item.key === key
                  ? { ...item, state: "failed", error: message }
                  : item,
              ),
            );
          }
        }
      }
    },
    [beforeMutation, getExpectedVersion, noteId, onNoteChanged, uploadDisabled],
  );

  useImperativeHandle(ref, () => ({ uploadFiles }), [uploadFiles]);

  async function removeAttachment(attachment: AttachmentItem) {
    if (!(await beforeMutation())) return;
    setRemovePending(true);
    setError(null);
    try {
      const response = await fetch(`/api/attachments/${attachment.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: getExpectedVersion() }),
      });
      const payload = (await response.json()) as
        { id: string; deleted: true; note: NoteDetail } | ApiError;
      if (!response.ok || "error" in payload) {
        throw new Error(
          "error" in payload
            ? payload.error.message
            : "The attachment could not be removed",
        );
      }
      setAttachments((current) =>
        current.filter(({ id }) => id !== attachment.id),
      );
      setRemoveTarget(null);
      onNoteChanged(payload.note);
    } catch (removeError) {
      setError(
        removeError instanceof Error
          ? removeError.message
          : "The attachment could not be removed",
      );
    } finally {
      setRemovePending(false);
    }
  }

  return (
    <section className="attachment-panel" aria-labelledby="attachments-title">
      <header>
        <div>
          <Paperclip size={16} aria-hidden="true" />
          <h2 id="attachments-title">Attachments</h2>
          <span>{attachments.length}</span>
        </div>
        <button
          type="button"
          disabled={uploadDisabled}
          title="Attach files"
          onClick={() => inputRef.current?.click()}
        >
          <Upload size={15} aria-hidden="true" />
          Add files
        </button>
        <input
          ref={inputRef}
          className="sr-only"
          type="file"
          multiple
          aria-label="Choose files to attach"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            void uploadFiles(files);
          }}
        />
      </header>
      <p className="attachment-hint">
        Pick files, drop them into the editor, or paste an image. The configured
        limit is 100 MiB by default.
      </p>

      {error ? (
        <div className="attachment-error" role="alert">
          <AlertTriangle size={15} aria-hidden="true" />
          {error}
          <button type="button" onClick={() => void load()}>
            Retry
          </button>
        </div>
      ) : null}

      {uploads.length ? (
        <div className="attachment-uploads" aria-label="Attachment uploads">
          {uploads.map((upload) => (
            <div key={upload.key} data-state={upload.state}>
              <File size={16} aria-hidden="true" />
              <span>
                <strong>{upload.file.name || "Pasted image"}</strong>
                <small>
                  {upload.state === "uploading"
                    ? `${upload.progress}% uploaded`
                    : upload.error}
                </small>
              </span>
              {upload.state === "uploading" ? (
                <>
                  <progress max={100} value={upload.progress}>
                    {upload.progress}%
                  </progress>
                  <button
                    type="button"
                    aria-label={`Cancel upload ${upload.file.name}`}
                    onClick={() => requestsRef.current.get(upload.key)?.abort()}
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setUploads((current) =>
                        current.filter(({ key }) => key !== upload.key),
                      );
                      void uploadFiles([upload.file]);
                    }}
                  >
                    <RefreshCcw size={14} aria-hidden="true" /> Retry
                  </button>
                  <button
                    type="button"
                    aria-label={`Dismiss failed upload ${upload.file.name}`}
                    onClick={() =>
                      setUploads((current) =>
                        current.filter(({ key }) => key !== upload.key),
                      )
                    }
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      ) : null}

      {loading ? (
        <div className="attachment-state" role="status">
          <LoaderCircle className="spin" size={17} aria-hidden="true" />
          Loading attachments…
        </div>
      ) : attachments.length === 0 && uploads.length === 0 ? (
        <div className="attachment-state">
          <Paperclip size={17} aria-hidden="true" />
          No attachments yet
        </div>
      ) : (
        <div className="attachment-grid">
          {attachments.map((attachment) => (
            <article key={attachment.id} className="attachment-card">
              {attachment.previewUrl && attachment.available ? (
                // Safe image types only; the endpoint adds nosniff and a sandboxed CSP.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={attachment.previewUrl}
                  alt={attachment.originalName}
                  loading="lazy"
                />
              ) : (
                <span className="attachment-file-mark" aria-hidden="true">
                  {attachment.mimeType.startsWith("image/") ? (
                    <FileImage size={22} />
                  ) : (
                    <File size={22} />
                  )}
                </span>
              )}
              <div>
                <strong title={attachment.originalName}>
                  {attachment.originalName}
                </strong>
                <small>
                  {formatBytes(attachment.byteSize)} · {attachment.mimeType}
                </small>
                {attachment.width && attachment.height ? (
                  <small>
                    {attachment.width} × {attachment.height}
                  </small>
                ) : null}
                {!attachment.available ? (
                  <span className="attachment-missing" role="status">
                    <AlertTriangle size={13} aria-hidden="true" />
                    Local bytes are {attachment.unavailableReason}
                  </span>
                ) : null}
              </div>
              <footer>
                {attachment.available ? (
                  <a href={attachment.downloadUrl} download>
                    <Download size={14} aria-hidden="true" /> Download
                  </a>
                ) : null}
                {removeTarget === attachment.id ? (
                  <>
                    <button
                      type="button"
                      disabled={removePending}
                      onClick={() => setRemoveTarget(null)}
                    >
                      Keep
                    </button>
                    <button
                      type="button"
                      className="danger-button"
                      disabled={removePending}
                      onClick={() => void removeAttachment(attachment)}
                    >
                      {removePending ? "Removing…" : "Remove file"}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    aria-label={`Remove attachment ${attachment.originalName}`}
                    onClick={() => setRemoveTarget(attachment.id)}
                  >
                    <Trash2 size={14} aria-hidden="true" /> Remove
                  </button>
                )}
              </footer>
            </article>
          ))}
        </div>
      )}

      {nextCursor ? (
        <button
          type="button"
          className="load-more-button"
          disabled={loadingMore}
          onClick={() => void load(nextCursor)}
        >
          {loadingMore ? "Loading…" : "Load more attachments"}
        </button>
      ) : null}
    </section>
  );
});

function uploadOne(
  noteId: string,
  file: File,
  expectedVersion: number,
  onProgress: (progress: number) => void,
  onRequest: (request: XMLHttpRequest) => void,
) {
  return new Promise<{ attachment: AttachmentItem; note: NoteDetail }>(
    (resolve, reject) => {
      const query = new URLSearchParams({
        expectedVersion: expectedVersion.toString(),
      });
      const request = new XMLHttpRequest();
      onRequest(request);
      request.open("POST", `/api/notes/${noteId}/attachments?${query}`);
      request.setRequestHeader(
        "Content-Type",
        file.type || "application/octet-stream",
      );
      request.setRequestHeader(
        "X-Linked-Notes-Filename",
        encodeURIComponent(file.name || `pasted-image-${Date.now()}`),
      );
      request.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          onProgress(
            Math.min(100, Math.round((event.loaded / event.total) * 100)),
          );
        }
      };
      request.onload = () => {
        try {
          const payload = JSON.parse(request.responseText) as
            { attachment: AttachmentItem; note: NoteDetail } | ApiError;
          if (
            request.status < 200 ||
            request.status >= 300 ||
            "error" in payload
          ) {
            reject(
              new Error(
                "error" in payload
                  ? payload.error.message
                  : "The upload failed",
              ),
            );
            return;
          }
          onProgress(100);
          resolve(payload);
        } catch {
          reject(new Error("The upload returned an invalid response"));
        }
      };
      request.onerror = () => reject(new Error("The upload was interrupted"));
      request.onabort = () => reject(new Error("Upload cancelled"));
      request.send(file);
    },
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KiB`;
  return `${(bytes / 1_048_576).toFixed(1)} MiB`;
}
