/**
 * PDF Loader module.
 * Auto-detects input source (Base64, absolute HTTP(S) URL, or Dataverse Web API path),
 * handles password authentication, task cancellation, and translates errors into friendly messages.
 */
import { pdfjsLib } from "./pdfBootstrap";
import { base64ToUint8Array, hasPdfSignature, stripSurroundingQuotes } from "./base64";
import { ensurePdfWorker, resetPdfWorker } from "./pdfWorkerHelper";

export interface LoadedPdfData {
    document: pdfjsLib.PDFDocumentProxy;
    rawBytes?: Uint8Array;
}

export type SourceType = "base64" | "url" | "dataverse";

export interface SourceInfo {
    type: SourceType;
    cleanSource: string;
}

/**
 * Detects the source format of the provided string.
 */
export function detectSourceType(source: string): SourceInfo {
    const cleaned = stripSurroundingQuotes(source);

    if (/^https?:\/\//i.test(cleaned)) {
        return { type: "url", cleanSource: cleaned };
    }

    if (cleaned.startsWith("/api/data/")) {
        return { type: "dataverse", cleanSource: cleaned };
    }

    return { type: "base64", cleanSource: cleaned };
}

export class PdfLoader {
    private currentLoadingTask: pdfjsLib.PDFDocumentLoadingTask | null = null;
    private loadSequenceId = 0;

    /**
     * Loads a PDF document from base64, URL, or Dataverse path.
     * Prevents race conditions by aborting any previous in-flight task.
     *
     * @param source Raw source string from PdfSource input property.
     * @param password Optional password for encrypted PDFs.
     * @param isRetry Internal flag indicating retry with main-thread fallback.
     * @returns Loaded PDF proxy and raw bytes (for downloads).
     */
    public async load(source: string, password?: string, isRetry = false): Promise<LoadedPdfData> {
        // Ensure the worker is ready
        ensurePdfWorker();

        // Increment sequence ID to discard older asynchronous results
        const seqId = ++this.loadSequenceId;

        // Cancel previous loading task if still running
        this.cancelCurrentTask();

        const detected = detectSourceType(source);
        let bytes: Uint8Array | undefined;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let docParams: any;

        if (detected.type === "url") {
            docParams = {
                url: detected.cleanSource,
                withCredentials: false
            };
        } else if (detected.type === "dataverse") {
            try {
                const response = await fetch(detected.cleanSource, {
                    method: "GET",
                    credentials: "same-origin",
                    headers: {
                        Accept: "application/pdf, application/octet-stream, */*"
                    }
                });

                if (!response.ok) {
                    if (response.status === 401 || response.status === 403) {
                        throw new Error(`Dataverse access denied (${response.status} ${response.statusText}).`);
                    } else if (response.status === 404) {
                        throw new Error("PDF document not found in Dataverse (404).");
                    } else {
                        throw new Error(`Dataverse fetch failed with status ${response.status} (${response.statusText}).`);
                    }
                }

                const buffer = await response.arrayBuffer();
                bytes = new Uint8Array(buffer);

                if (!hasPdfSignature(bytes)) {
                    throw new Error("The data retrieved from Dataverse is not a valid PDF.");
                }

                docParams = { data: bytes };
            } catch (fetchErr) {
                if (seqId !== this.loadSequenceId) {
                    throw new Error("Superceded");
                }
                throw fetchErr;
            }
        } else {
            // Base64 input (primary path)
            bytes = base64ToUint8Array(detected.cleanSource);
            docParams = { data: bytes };
        }

        if (seqId !== this.loadSequenceId) {
            throw new Error("Superceded");
        }

        // Configure pdf.js loading task
        const loadingTask = pdfjsLib.getDocument(docParams);
        this.currentLoadingTask = loadingTask;

        let passwordError: string | null = null;

        loadingTask.onPassword = (callback: (pwd: string) => void, reason: number): void => {
            if (reason === pdfjsLib.PasswordResponses.NEED_PASSWORD) {
                if (password && password.length > 0) {
                    callback(password);
                } else {
                    passwordError = "Password required";
                    callback("");
                }
            } else if (reason === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD) {
                passwordError = "Incorrect password";
                callback("");
            }
        };

        try {
            const document = await loadingTask.promise;

            if (seqId !== this.loadSequenceId) {
                document.destroy();
                throw new Error("Superceded");
            }

            this.currentLoadingTask = null;
            return { document, rawBytes: bytes };
        } catch (err: unknown) {
            if (seqId !== this.loadSequenceId) {
                throw new Error("Superceded");
            }
            this.currentLoadingTask = null;

            // Handle abort/cancel gracefully
            const errorObj = err as { name?: string; message?: string };
            if (errorObj?.name === "AbortException" || errorObj?.message === "Superceded") {
                throw err;
            }

            const rawMsg = errorObj?.message || String(err);

            // Self-healing: if worker failed to load or start script, reset to main-thread worker and retry once
            if (!isRetry && (/worker/i.test(rawMsg) || /Cannot load script at/i.test(rawMsg))) {
                console.warn("[PdfViewer] Worker failure detected, resetting to main-thread execution and retrying:", rawMsg);
                resetPdfWorker();
                return this.load(source, password, true);
            }

            // Translate into clear, actionable error messages
            if (passwordError) {
                throw new Error(passwordError);
            }

            if (errorObj?.name === "PasswordException") {
                throw new Error(password ? "Incorrect password" : "Password required");
            }

            if (errorObj?.name === "InvalidPDFException") {
                throw new Error("The PDF document is corrupted or damaged.");
            }

            if (errorObj?.name === "MissingPDFException") {
                throw new Error("The specified PDF could not be found (404).");
            }

            if (errorObj?.name === "UnexpectedResponseException") {
                throw new Error("Server returned an unexpected response while loading the PDF.");
            }

            if (/Failed to fetch|NetworkError|CORS/i.test(rawMsg)) {
                throw new Error("Failed to load PDF from URL. Check network connection and CORS headers.");
            }

            throw new Error(rawMsg);
        }
    }

    /**
     * Aborts any currently active loading task.
     */
    public cancelCurrentTask(): void {
        if (this.currentLoadingTask) {
            try {
                this.currentLoadingTask.destroy();
            } catch {
                // Ignore destruction error during cancel
            }
            this.currentLoadingTask = null;
        }
    }
}
