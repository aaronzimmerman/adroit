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
        /** A move's suspects: the moved subtree, the record itself included. */
        moved: string[];
        /** Model fields citing this ruling: its migration surface. */
        modelFields: {
            model: string;
            field: string;
        }[];
    }>;
    change: (req: ChangeRequest) => Promise<ChangeOutcome>;
    citations: (id: string) => Promise<{
        id: string;
        citations: CodeCitation[];
        axis: string;
    }>;
};
