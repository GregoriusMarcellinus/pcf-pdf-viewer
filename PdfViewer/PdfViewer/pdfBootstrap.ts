/**
 * Bootstrap module to expose pdfjsLib globally.
 * Mozilla pdfjs-dist legacy pdf_viewer.js requires globalThis.pdfjsLib to be
 * defined when its modules are initialized (specifically for AnnotationEditorType,
 * PromiseCapability, and AnnotationLayer).
 */
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf";

(globalThis as unknown as { pdfjsLib?: typeof pdfjsLib }).pdfjsLib = pdfjsLib;
if (typeof window !== "undefined") {
    (window as unknown as { pdfjsLib?: typeof pdfjsLib }).pdfjsLib = pdfjsLib;
}

/**
 * Patch Mozilla PDF.js bug in AnnotationEditorUIManager.prototype.destroy:
 * Mozilla called `this.#altTextManager.destroy()` without optional chaining (unlike line 8424).
 * If altTextManager is null/undefined (the default when not passed to PDFViewer),
 * destroy() throws `TypeError: Cannot read properties of null (reading 'destroy')` whenever
 * setDocument() is called a second time on the same PDFViewer instance.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const uiManagerProto = (pdfjsLib as any).AnnotationEditorUIManager?.prototype;
if (uiManagerProto && typeof uiManagerProto.destroy === "function") {
    const originalDestroy = uiManagerProto.destroy;
    uiManagerProto.destroy = function (this: unknown, ...args: unknown[]) {
        try {
            return originalDestroy.apply(this, args);
        } catch (err: unknown) {
            if (err instanceof TypeError && /reading\s*['"]destroy['"]/i.test(err.message)) {
                // Safely intercept and ignore missing altTextManager.destroy() call
                return;
            }
            throw err;
        }
    };
}

export { pdfjsLib };
