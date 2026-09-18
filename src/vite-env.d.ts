/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PIX_PAID_REDIRECT_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
