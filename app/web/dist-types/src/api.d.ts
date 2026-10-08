import type { ChangeOutcome, ChangeRequest, CodeCitation, LedgerSnapshot, SearchHit } from '@adroit/shared';
export declare class ApiRefusal extends Error {
}
export declare const api: {
    ledger: () => Promise<LedgerSnapshot>;
    search: (q: string) => Promise<{
        query: string;
        hits: SearchHit[];
    }>;
    impact: (id: string) => Promise<{
        id: string;
        descendants: string[];
        consumers: string[];
        dependents: string[];
    }>;
    change: (req: ChangeRequest) => Promise<ChangeOutcome>;
    confirm: (id: string, note: string) => Promise<ChangeOutcome>;
    citations: (id: string) => Promise<{
        id: string;
        citations: CodeCitation[];
        axis: string;
    }>;
    modelUsage: (id: string) => Promise<{
        id: string;
        usage: {
            field: string;
            count: number;
            files: string[];
        }[];
        axis: string;
    }>;
};
