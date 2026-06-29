import Secret from 'gi://Secret';

const SECRET_SCHEMA = new Secret.Schema('org.gnome.shell.extensions.copilot-usage.token', Secret.SchemaFlags.NONE, {
    service: Secret.SchemaAttributeType.STRING,
    account: Secret.SchemaAttributeType.STRING,
});

const SECRET_ATTRIBUTES = {
    service: 'gnome-shell-extension',
    account: 'copilot-usage@davidpcls',
};

const LEGACY_SECRET_ATTRIBUTES = {
    service: 'github',
    account: 'copilot-usage',
};

const SECRET_LABEL = 'GNOME Extension: Copilot Usage API Token';

export function extractTokenCandidate(rawValue) {
    const value = String(rawValue ?? '').trim();
    if (value === '') {
        return '';
    }

    const lowered = value.toLowerCase();
    if (lowered.startsWith('github_pat_') || lowered.startsWith('ghp_') || lowered.startsWith('gho_')) {
        return value;
    }

    if (lowered.startsWith('token ')) {
        return value.slice('token '.length).trim();
    }

    if (lowered.startsWith('bearer ')) {
        return value.slice('bearer '.length).trim();
    }

    return value;
}

export class TokenStore {
    migrateFromSettings(settings) {
        const legacyToken = extractTokenCandidate(settings.get_string('api-token'));
        if (legacyToken === '') {
            return {migrated: false, errorCode: null};
        }

        try {
            this.storeToken(legacyToken);
            settings.set_string('api-token', '');
            return {migrated: true, errorCode: null};
        } catch (e) {
            return {migrated: false, errorCode: 'keyring-unavailable'};
        }
    }

    getToken() {
        try {
            const currentToken = Secret.password_lookup_sync(SECRET_SCHEMA, SECRET_ATTRIBUTES, null);
            const parsedCurrent = extractTokenCandidate(currentToken);
            if (parsedCurrent !== '') {
                return {token: parsedCurrent, errorCode: null};
            }

            const legacyToken = Secret.password_lookup_sync(SECRET_SCHEMA, LEGACY_SECRET_ATTRIBUTES, null);
            const parsedLegacy = extractTokenCandidate(legacyToken);
            if (parsedLegacy === '') {
                return {token: null, errorCode: 'missing-token'};
            }

            this.storeToken(parsedLegacy);
            Secret.password_clear_sync(SECRET_SCHEMA, LEGACY_SECRET_ATTRIBUTES, null);
            return {token: parsedLegacy, errorCode: null};
        } catch (e) {
            return {token: null, errorCode: 'keyring-unavailable'};
        }
    }

    hasStoredToken() {
        const result = this.getToken();
        return result.errorCode === null && result.token !== null;
    }

    storeToken(rawToken) {
        const token = extractTokenCandidate(rawToken);
        if (token === '') {
            throw new Error('empty-token');
        }

        const stored = Secret.password_store_sync(
            SECRET_SCHEMA,
            SECRET_ATTRIBUTES,
            Secret.COLLECTION_DEFAULT,
            SECRET_LABEL,
            token,
            null
        );

        if (!stored) {
            throw new Error('store-failed');
        }
    }

    clearToken() {
        Secret.password_clear_sync(SECRET_SCHEMA, SECRET_ATTRIBUTES, null);
        Secret.password_clear_sync(SECRET_SCHEMA, LEGACY_SECRET_ATTRIBUTES, null);
    }
}
