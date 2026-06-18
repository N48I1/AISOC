# Aegis SOC Platform - Maintenance & Fix Log (April 2026)

This document tracks the diagnostic steps and fixes applied to resolve issues with the SOC platform's alert ingestion and AI orchestration.

## 1. Port Conflict Resolution
- **Issue:** The default port `3000` was occupied by a system process (`tenzir-node`), causing the SOC server to shift to port `3001`.
- **Symptoms:** Frontend could not reach the backend, and ingestion scripts were failing with "Connection Refused."
- **Change:** 
    - Updated `ingest-sample.ts` to dynamically use the `PORT` environment variable or default to `3001`.
    - Verified the server is operational at [http://localhost:3001](http://localhost:3001).

## 2. AI Orchestration & Model Stability
- **Issue:** OpenRouter returned `400 Provider errors` and `429 Rate limits` for several free models (specifically Llama 3.3).
- **Change:**
    - Restructured `agents/config.ts` to include a broader range of high-availability free models.
    - Updated `DEFAULT_AGENT_MODELS` to distribute load across multiple providers to mitigate individual rate limits.
- **Model Assignments:**
    - **Analysis:** `google/gemini-2.0-flash-lite-preview-02-05:free`
    - **Threat Intel:** `mistralai/mistral-7b-instruct:free`
    - **Knowledge (RAG):** `openai/gpt-oss-120b:free`
    - **Correlation:** `meta-llama/llama-3.3-70b-instruct:free`
    - **Ticketing:** `google/gemini-2.0-flash-lite-preview-02-05:free`
    - **Response:** `mistralai/mistral-7b-instruct:free`
    - **Validation:** `microsoft/phi-3-mini-128k-instruct:free`

## 3. Ingestion Script Improvements
- **Issue:** Hardcoded URLs in test scripts prevented data entry when the server port changed.
- **Change:**
    - Modified `ingest-sample.ts` to use port `3001`.
    - Improved error logging in ingestion scripts to provide clearer feedback on network failures.

## 4. Environment & Deployment Notes
- **Frontend:** Since the server serves from the `dist/` directory, any UI changes require a rebuild (`npm run build`).
- **Development Mode:** For live UI updates, use `USE_VITE_MIDDLEWARE=true` in `.env`.
- **Database:** Verified `soc.db` integrity. Alert count successfully increased to 13 after ingestion fixes.

---
**Status:** System is operational on port 3001. AI agents are configured with the requested model mix but remain subject to OpenRouter's daily free-tier quotas.
