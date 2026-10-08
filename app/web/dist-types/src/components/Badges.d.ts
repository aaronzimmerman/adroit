import type { DerivedRecord, DubiousReason } from '@adroit/shared';
export declare function DubiousBadge({ record }: {
    record: Pick<DerivedRecord, 'dubious'>;
}): import("react").JSX.Element | null;
export declare function describeReason(r: DubiousReason): string;
export declare function Hierarchy({ ids }: {
    ids: string[];
}): import("react").JSX.Element | null;
