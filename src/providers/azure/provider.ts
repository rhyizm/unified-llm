// src/providers/azure/provider.ts
import { OpenAICompletionProvider } from '../openai';
import OpenAI, { AzureOpenAI } from 'openai';
import { TokenCredential } from '@azure/core-auth';

/* Azure 固有の接続情報 */
interface AzureAuth {
  endpoint: string;                   // https://<resource>.openai.azure.com
  deployment: string;                 // デプロイ名
  apiVersion?: string;                // "2024-10-21" / "preview" など
  aadTokenProvider?: () => Promise<TokenCredential>;
  useV1?: boolean;                    // true = /openai/v1
}

/* OpenAICompletionProvider の第1引数から model だけ除外 (apiKey は残す) */
type OpenAIBaseOpts = Omit<
  ConstructorParameters<typeof OpenAICompletionProvider>[0],
  'model'
>;

export class AzureOpenAIProvider extends OpenAICompletionProvider {
  protected client!: OpenAI | AzureOpenAI;

  constructor(auth: AzureAuth, base: OpenAIBaseOpts) {
    /* 親には apiKey と model (= deployment) を渡す */
    super({ ...base, model: auth.deployment });

    const { apiKey }  = base;             // ← apiKey は統一してここから取得
    const apiVersion  = auth.apiVersion ?? 'preview';

    /* ── AAD 認証は旧 SDK (AzureOpenAI) 強制 ───────────────── */
    if (auth.aadTokenProvider) {
      this.initAzureOpenAI_AAD(auth, apiVersion);
      return;
    }

    /* ── API-Key 認証パス ──────────────────────────────────── */
    if (!apiKey) {
      throw new Error('AzureOpenAIProvider: apiKey is required unless aadTokenProvider is supplied');
    }

    if (auth.useV1) {
      this.initOpenAI_Key(auth, apiKey, apiVersion);      // /openai/v1
    } else {
      this.initAzureOpenAI_Key(auth, apiKey, apiVersion); // /deployments/…
    }
  }

  /* ---------- /openai/v1 (+ API-Key) ---------- */
  private initOpenAI_Key(auth: AzureAuth, apiKey: string, apiVersion: string) {
    this.client = new OpenAI({
      baseURL: `${auth.endpoint.replace(/\/$/, '')}/openai/v1/`,
      defaultQuery: { 'api-version': apiVersion },
      apiKey,                                  // 型合わせ
      defaultHeaders: { 'api-key': apiKey },   // Azure は "api-key" ヘッダー
    });
  }

  /* ---------- /deployments/ (+ API-Key) ---------- */
  private initAzureOpenAI_Key(auth: AzureAuth, apiKey: string, apiVersion: string) {
    this.client = new AzureOpenAI({
      endpoint: auth.endpoint,   // ← camelCase: endpoint
      apiVersion,
      apiKey,
      deployment: auth.deployment,
    });
  }

  /* ---------- /deployments/ (+ AAD) ---------- */
  private async initAzureOpenAI_AAD(auth: AzureAuth, apiVersion: string) {
    if (!auth.aadTokenProvider) {
      throw new Error('AzureOpenAIProvider: aadTokenProvider is required for AAD authentication');
    }
    const cred = await auth.aadTokenProvider();
    this.client = new AzureOpenAI({
      endpoint: auth.endpoint,
      apiVersion,
      deployment: auth.deployment,
      azureADTokenProvider: async () => {
        const t = await cred.getToken('https://cognitiveservices.azure.com/.default');
        if (!t?.token) throw new Error('AAD token acquisition failed');
        return t.token;
      },
    });
  }
}
