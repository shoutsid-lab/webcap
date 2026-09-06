import type { Db } from './index.js';

export type CaptureJobStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface CaptureJobRow {
  readonly id: string;
  readonly url: string;
  readonly format: string | null;
  readonly status: CaptureJobStatus;
  readonly artifact_url: string | null;
  readonly error: string | null;
  readonly payer: string | null;
  readonly price_usdc_units: number | null;
  readonly credits_used: number | null;
  readonly cost_usdc_units: number | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface NewCaptureJob {
  readonly id: string;
  readonly url: string;
  readonly format?: string | null;
  readonly payer?: string | null;
  readonly priceUsdcUnits?: number | null;
  readonly creditsUsed?: number | null;
  readonly costUsdcUnits?: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CaptureJobStatusPatch {
  readonly artifactUrl?: string | null;
  readonly error?: string | null;
  readonly payer?: string | null;
  readonly priceUsdcUnits?: number | null;
  readonly creditsUsed?: number | null;
  readonly costUsdcUnits?: number | null;
  readonly updatedAt: string;
}

export interface JobsRepo {
  create(job: NewCaptureJob): void;
  get(id: string): CaptureJobRow | null;
  setStatus(id: string, status: CaptureJobStatus, patch: CaptureJobStatusPatch): boolean;
}

const selectRow =
  'SELECT id, url, format, status, artifact_url, error, payer, price_usdc_units, credits_used, cost_usdc_units, ' +
  'created_at, updated_at FROM capture_jobs';

export function makeJobsRepo(db: Db): JobsRepo {
  const insertJob = db.prepare<
    [string, string, string | null, string, string | null, number | null, number | null, number | null, string, string],
    unknown
  >(
    'INSERT INTO capture_jobs (id, url, format, status, payer, price_usdc_units, credits_used, cost_usdc_units, created_at, updated_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const fetchJob = db.prepare<[string], CaptureJobRow>(`${selectRow} WHERE id = ?`);
  const updateStatus = db.prepare<
    [string, string | null, string | null, string | null, number | null, number | null, number | null, string, string],
    unknown
  >(
    'UPDATE capture_jobs SET status = ?, artifact_url = ?, error = ?, payer = ?, price_usdc_units = ?, ' +
      'credits_used = ?, cost_usdc_units = ?, updated_at = ? WHERE id = ?',
  );

  return {
    create(job: NewCaptureJob): void {
      insertJob.run(
        job.id,
        job.url,
        job.format ?? null,
        'queued',
        job.payer ?? null,
        job.priceUsdcUnits ?? null,
        job.creditsUsed ?? null,
        job.costUsdcUnits ?? null,
        job.createdAt,
        job.updatedAt,
      );
    },
    get(id: string): CaptureJobRow | null {
      return fetchJob.get(id) ?? null;
    },
    setStatus(id: string, status: CaptureJobStatus, patch: CaptureJobStatusPatch): boolean {
      const current = fetchJob.get(id);
      if (current === undefined) return false;
      updateStatus.run(
        status,
        patch.artifactUrl ?? current.artifact_url,
        patch.error ?? current.error,
        patch.payer ?? current.payer,
        patch.priceUsdcUnits ?? current.price_usdc_units,
        patch.creditsUsed ?? current.credits_used,
        patch.costUsdcUnits ?? current.cost_usdc_units,
        patch.updatedAt,
        id,
      );
      return true;
    },
  };
}
