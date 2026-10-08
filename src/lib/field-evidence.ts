// The body Field mode sends to PATCH /internal/api/job-evidence, in one place so the page and the test
// build it the same way.
//
// The API reads camelCase keys (openingIndex, exceptionStatus, exceptionNotes, materialUsage, photoSummary).
// Until 2026-10-08 the page sent the saved row's snake_case names (opening_index, exception_status,
// exception_notes), so every save was refused with "openingIndex must be a non-negative integer." and the
// Verify gate could not be passed from the phone. scripts/test-internal-audit.mjs runs this exact body
// through the real handler.

export type EvidencePayload = {
  openingIndex: number;
  measurements: Record<string, number>;
  notes: string;
  exceptionStatus: string;
  exceptionNotes: string;
  materialUsage: Record<string, number>;
  photoSummary?: Record<string, number>;
};

export function evidencePayload(input: {
  openingIndex: number;
  measurements: Record<string, number>;
  notes?: string;
  exceptionStatus?: string;
  exceptionNotes?: string;
  materialUsage: Record<string, number>;
  photoSummary?: Record<string, number>;
}): EvidencePayload {
  const payload: EvidencePayload = {
    openingIndex: input.openingIndex,
    measurements: input.measurements,
    notes: (input.notes || '').slice(0, 5000),
    exceptionStatus: input.exceptionStatus || 'none',
    exceptionNotes: (input.exceptionNotes || '').slice(0, 5000),
    materialUsage: input.materialUsage,
  };
  if (input.photoSummary) payload.photoSummary = input.photoSummary;
  return payload;
}
