# Power Apps PDF Viewer PCF Control

A production-grade, open-source Power Apps Component Framework (PCF) control for viewing, navigating, and annotating PDF documents in Power Apps Canvas Apps and Model-Driven Apps. Built on Mozilla `pdf.js` (legacy build v3.11.174), it is 100% self-contained: **zero paid licenses, zero server-side components, and zero external CDN dependencies**.

---

## Default Configuration

- **Prefix**: `grey`
- **Namespace**: `Grey`
- **Publisher**: `Grey`
- **Dataverse Control Identifier**: `grey_Grey.PdfViewer`

---

## Pre-Built Managed Solution

The ready-to-import Default Managed Solution is located in [`Solutions/Managed/`](./Solutions/Managed/):

| Variant | Publisher | Customization Prefix | Namespace | Dataverse Component Identifier | Managed Solution Package |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Grey (Default)** | `Grey` | `grey` | `Grey` | `grey_Grey.PdfViewer` | [`Solutions/Managed/PdfViewer_Grey_managed.zip`](./Solutions/Managed/PdfViewer_Grey_managed.zip) |

*(Additional publisher variants such as Sigma or DITPAM can be built locally using `build-all.cmd`).*

---

## Features & Highlights

- **100% Self-Contained**: All dependencies, styles, icons, and worker bundles are packaged locally into the control. No external internet or CDN calls are made at runtime.
- **Embedded Web Worker with Self-Healing Fallback**: Off-thread PDF parsing via a persistent blob worker singleton. If host CSP restricts blob workers, it automatically falls back to main-thread parsing without interruption.
- **Base64-First Pipeline**: Handles raw base64, data URIs (`data:application/pdf;base64,...`), Power Fx `JSON()` quoted strings, MIME linebreaks, and URL-safe base64.
- **Continuous Scrolling & Text Selection**: Seamless continuous multi-page layout with native selectable text for copy-pasting.
- **Annotation & Editing Suite**:
  - **Highlight**: Text highlighter with color and opacity options.
  - **Draw / Freehand Ink**: Drawing tool with color, thickness, and opacity.
  - **Text Comments**: In-place text notes and annotations.
  - **Images / Stamp**: Add image signatures or stamps.
  - **Action Controls**: Print and Download buttons.
  - Each tool supports `Show<Tool>` and `DisplayMode<Tool>` (`Edit`, `View`, `Disabled`) configuration.
- **`EditedPdf` Output Property**: Captures all user annotations and edits, exporting the updated PDF as a Base64 string directly into Power Apps (can be passed to Power Automate flows or saved back to Dataverse).
- **Smooth Subsequent Loading**: Fixes for Mozilla PDF.js UI manager destroy lifecycles, enabling repeated document re-loads within the same screen/component without error.

---

## Properties Reference

### Inputs & Bindings

| Property | Type | Usage | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `PdfSource` | Multiple | bound | *(Required)* | Base64 string, data URI (`data:application/pdf;base64,...`), absolute URL, or relative Dataverse Web API path (`/api/data/...`). |
| `Zoom` | SingleLine.Text | input | `page-width` | Zoom preset (`page-width`, `page-fit`, `auto`) or numeric scale factor (e.g. `1.25`, `1.5`). |
| `GoToPage` | Whole.None | input | `none` | Jump to a target page number dynamically when this value changes. |
| `Password` | SingleLine.Text | input | `""` | Password for encrypted/protected PDFs. |
| `ShowToolbar` | TwoOptions | input | `true` | Show or hide the top navigation toolbar. |
| `AllowDownload` | TwoOptions | input | `true` | Show or hide the download button in the toolbar. |
| `ShowHighlight` | TwoOptions | input | `true` | Show or hide the Highlight button. |
| `DisplayModeHighlight` | SingleLine.Text | input | `Edit` | DisplayMode for Highlight (`Edit`, `View`, `Disabled`). |
| `ShowDraw` | TwoOptions | input | `true` | Show or hide the Draw ink annotation button. |
| `DisplayModeDraw` | SingleLine.Text | input | `Edit` | DisplayMode for Draw (`Edit`, `View`, `Disabled`). |
| `ShowText` | TwoOptions | input | `true` | Show or hide the Add text comment button. |
| `DisplayModeText` | SingleLine.Text | input | `Edit` | DisplayMode for Text Comment (`Edit`, `View`, `Disabled`). |
| `ShowStamp` | TwoOptions | input | `true` | Show or hide the Add images/stamp button. |
| `DisplayModeStamp` | SingleLine.Text | input | `Edit` | DisplayMode for Stamp (`Edit`, `View`, `Disabled`). |
| `ShowPrint` | TwoOptions | input | `true` | Show or hide the Print PDF button. |
| `DisplayModePrint` | SingleLine.Text | input | `Edit` | DisplayMode for Print (`Edit`, `View`, `Disabled`). |
| `ShowDownload` | TwoOptions | input | `true` | Show or hide the Download button. |
| `DisplayModeDownload` | SingleLine.Text | input | `Edit` | DisplayMode for Download (`Edit`, `View`, `Disabled`). |

### Outputs

| Property | Type | Usage | Description |
| :--- | :--- | :--- | :--- |
| `LoadStatus` | SingleLine.Text | output | Current lifecycle status: `Idle`, `Loading`, `Loaded`, or `Error`. |
| `ErrorMessage` | SingleLine.Text | output | Details of the last encountered error, if any. |
| `EditedPdf` | Multiple | output | Base64-encoded string of the edited PDF document, including all annotations and edits. |

---

## Automated Multi-Solution Build

Whenever you make updates to the PCF control code, you can build and verify all 3 solution packages simultaneously by running:

```cmd
build-all.cmd
```

Or via PowerShell:
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-all-solutions.ps1
```

---

## License

This project is licensed under the MIT License. Mozilla `pdf.js` is licensed under the Apache 2.0 License.
