export function normalizeQuotaData(payload) {
    const snapshot = extractPremiumInteractionsSnapshot(payload);
    if (snapshot === null) {
        return {
            used: null,
            remaining: null,
            entitlement: null,
            percentUsed: 0,
            percentRemaining: 0,
            hasFiniteQuota: false,
            unlimited: false,
            resetLabel: '—',
            planLabel: extractPlanLabel(payload, null),
        };
    }

    const entitlement = extractNumericValue(snapshot, ['entitlement']);
    let remaining = extractNumericValue(snapshot, ['remaining', 'quota_remaining']);
    let used = extractNumericValue(snapshot, ['used', 'quota_used']);
    const unlimited = coerceBoolean(snapshot.unlimited);

    if (entitlement !== null && remaining !== null) {
        used = Math.max(0, entitlement - remaining);
    } else if (entitlement !== null && used !== null) {
        remaining = Math.max(0, entitlement - used);
    }

    const hasFiniteQuota = !unlimited
        && entitlement !== null
        && entitlement > 0
        && remaining !== null
        && used !== null;

    const percentUsed = hasFiniteQuota ? clampPercent((used / entitlement) * 100) : 0;
    const percentRemaining = hasFiniteQuota ? clampPercent((remaining / entitlement) * 100) : 0;

    return {
        used,
        remaining,
        entitlement,
        percentUsed,
        percentRemaining,
        hasFiniteQuota,
        unlimited,
        resetLabel: extractResetLabel(snapshot, payload),
        planLabel: extractPlanLabel(payload, snapshot),
    };
}

export function formatCredits(value) {
    const numeric = coerceNumber(value);
    if (numeric === null) {
        return '—';
    }

    if (Number.isInteger(numeric)) {
        return `${numeric}`;
    }

    return `${numeric.toFixed(2)}`;
}

export function clampPercent(value) {
    const numeric = coerceNumber(value) ?? 0;
    return Math.min(100, Math.max(0, numeric));
}

function extractPremiumInteractionsSnapshot(payload) {
    const quotaSnapshots = payload?.quota_snapshots;
    const nested = quotaSnapshots?.premium_interactions;
    if (nested && typeof nested === 'object') {
        return nested;
    }

    return null;
}

function extractNumericValue(source, keys) {
    for (const key of keys) {
        const numeric = coerceNumber(source?.[key]);
        if (numeric !== null) {
            return numeric;
        }
    }

    return null;
}

function extractResetLabel(snapshot, payload) {
    const candidates = [
        snapshot?.quota_reset_date_utc,
        snapshot?.quota_reset_date,
        payload?.quota_reset_date_utc,
        payload?.quota_reset_date,
    ];

    for (const candidate of candidates) {
        const formatted = formatResetDate(candidate);
        if (formatted !== '') {
            return formatted;
        }
    }

    return '—';
}

function extractPlanLabel(payload, snapshot) {
    const candidates = [
        payload?.copilot_plan,
        payload?.access_type_sku,
        snapshot?.plan,
        snapshot?.sku,
    ];

    for (const candidate of candidates) {
        if (typeof candidate !== 'string') {
            continue;
        }

        const trimmed = candidate.trim();
        if (trimmed !== '') {
            return trimmed;
        }
    }

    return null;
}

function coerceNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === 'string') {
        const parsed = Number.parseFloat(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }

    return null;
}

function coerceBoolean(value) {
    if (typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'string') {
        const lowered = value.trim().toLowerCase();
        if (lowered === 'true') {
            return true;
        }

        if (lowered === 'false') {
            return false;
        }
    }

    return false;
}

function formatResetDate(value) {
    const raw = String(value ?? '').trim();
    if (raw === '') {
        return '';
    }

    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
        const year = parsed.getUTCFullYear();
        const month = String(parsed.getUTCMonth() + 1).padStart(2, '0');
        const day = String(parsed.getUTCDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    const simpleDateMatch = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    if (simpleDateMatch) {
        return simpleDateMatch[1];
    }

    return raw;
}
