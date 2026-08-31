# Product Requirements Document: HDPsyChart Web Application (Open-Source Edition)

## 1. Open-Source Philosophy & Licensing
*   **Licensing:** Open-source license (exact license TBD). All selected third-party dependencies, libraries, and Rust crates must be audited to ensure compliance with permissive open-source standards (e.g., MIT, Apache 2.0).
*   **Community Contributions:** Architecture must prioritize modularity and strict separation of concerns (Calculation vs. State vs. UI) to allow independent community contributions.
*   **Local Execution:** The application must be capable of running entirely locally or self-hosted via Docker without reliance on proprietary external APIs.

## 2. System Architecture & Technology Stack
*   **Frontend Framework:** React built with **TypeScript (TSC)** for strict type safety across UI and business logic.
*   **State Management:** Zustand (or Redux) utilizing strict TypeScript interfaces for handling complex thermodynamic application states, point collections, and UI toggles.
*   **Thermodynamic Backend:** Rust compiled to WebAssembly (WASM) utilizing the `RustProp` library for zero-latency client-side calculations.
*   **WASM Bridge:** `wasm-bindgen` generating TypeScript definitions (`.d.ts`) to ensure Rust structs map directly to TypeScript interfaces across the language barrier.
*   **Rendering Engine:** HTML5 `<canvas>` via React-Konva (or custom WebGL/Canvas API) utilizing a strict Z-index layering pipeline.
*   **CI/CD & Deployment:** GitHub Actions for automated Rust testing, WASM compilation, and frontend building. Deployable to free-tier static hosting (e.g., GitHub Pages, Vercel, Netlify).

## 3. Core Psychrometric Engine (`RustProp` / WASM)
*   **Dual Chart Layouts:** Support for both the standard **ASHRAE format** (Dry-bulb vs. Humidity Ratio) and the **Mollier i-x Diagram** format (Enthalpy vs. Humidity Ratio).
*   **Unit Support:** Instant toggling between IP (Imperial) and SI (Metric) units.
*   **Elevation & Pressure:** Dynamic altitude adjustments (0 to 12,000 ft) and high-pressure support (up to 100 PSI).
*   **Sub-Zero & Fog Region:**
    *   Goff-Gratch / ASHRAE formulations for ice vs. water saturation below 0°C (32°F).
    *   Fog region dynamic saturation vs. mixture enthalpy calculations.
*   **Coordinate Transformation Engine:** Bi-directional mathematical mapping between screen coordinates `(x, y)` and physical chart properties `(T_db, W)` accounting for skewed axes.
*   **Performance:** 60 FPS calculation and render cycle during point drag-and-drop.

## 4. Process Analysis & HVAC Tools
*   **Psychrometric Processes:** Sensible heating/cooling, humidification, dehumidification, and general linear processes.
*   **Air Mixing:** Mass and energy balance mixing algorithms, including "Winter V" mixing with condensation handling.
*   **Automated HVAC Cycle Macros:** One-click macros to compute and plot multi-point cycles (e.g., Primary and Secondary Return Air Cycles) generating outputs for Sensible/Latent Heat (kW) and moisture addition/removal rates.
*   **Coil Calculators:** Apparatus Dew Point (ADP), Air Bypass Factor (ABF), and cooling coil performance lines.
*   **Advanced Vectors:** Interactive Sensible Heat Ratio (SHR) and Delta H / Delta W protractor to draw parallel reference lines.

## 5. Climatic Data & Standards Integration
*   **Bring-Your-Own-Data (BYOD):** Because hosting 80 million rows of weather data can be cost-prohibitive for an open-source project, the app must natively support dragging-and-dropping `.epw` (EnergyPlus) or CSV weather files directly into the browser for client-side processing.
*   **Standards Overlays:** ASHRAE Standard 55-2017/2020 comfort zones and ASHRAE TC 9.9 / NEBS Datacenter zones.
*   **Data Binning:** Client-side WASM statistical binning (0.5 to 6 degree increments) of uploaded historical weather data rendered as a density heatmap.

## 6. UI/UX & Layout Specs
*   **Top Navigation (48px):** Global controls for Project Management (Save/Load/Export), Unit Toggle, Elevation Input, Theme Toggle.
*   **Left Sidebar / Toolbox (64px):** Interactive tools (Select, Add State Point, Draw Process Line, Draw Shape, Crosshair Mode).
*   **Main Viewport:** Infinite panning and zoom-window controls for the primary canvas.
*   **Right Sidebar / Properties (320px):** Exact thermodynamic data. Supports both "Click on chart to set point" and "Manual numeric entry".
*   **Typography:** Monospaced fonts (JetBrains Mono/Fira Code) for numerical data readouts; Sans-serif (Inter/Roboto) for standard UI text.

## 7. Canvas Layering Hierarchy (Z-Index Pipeline)
*   **Layer 0 (Base Grid):** Cached skeleton of constant property curves.
*   **Layer 1 (Data Zones):** Semi-transparent SVG/Canvas polygons (Comfort/Datacenter zones).
*   **Layer 2 (Weather Binning):** Dense scatter plot or heatmap of hourly weather data.
*   **Layer 3 (Active Elements):** Interactive state points, directional process lines, text annotations.
*   **Layer 4 (HUD):** Dynamic crosshair snapped to grid with floating real-time property tooltip.

## 8. Customization & Theming
*   **Line Styling Matrix:** Dedicated UI modal to set Color, Line Style (Solid, Dotted, Dashed), and Width for *each* independent property family.
*   **CSS Variable Theming:** Deep structural reliance on CSS variables. This allows users who fork the open-source repo to instantly apply their own branding/colors via a single `theme.css` file without touching the React code.
*   **Internationalization (i18n):** JSON-based localization system to encourage the open-source community to contribute translations for the UI and reports.

## 9. Export, Import & Data Exchange
*   **Vector Export:** Direct SVG and DXF file generation for crisp CAD and documentation insertion.
*   **Reporting:** Auto-generated PDF state point and process reports combining the chart, flow diagram, and tabular data.
*   **Data Export/Import:** CSV/Excel output for points/processes.
*   **Local File Access:** Utilize the File System Access API to save/load `.psy` or `.json` project files directly to local machines, ensuring complete data privacy for users.
