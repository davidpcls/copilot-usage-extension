import GLib from 'gi://GLib';
import Soup from 'gi://Soup';

const GITHUB_API_ROOT = 'https://api.github.com';
const GITHUB_API_VERSION = '2026-03-10';
const USER_AGENT = 'copilot-gnome-extension';

export class GitHubApiClient {
    constructor() {
        this._session = new Soup.Session({
            timeout: 20,
            idle_timeout: 20,
        });
        this._retrySourceIds = new Set();
        this._destroyed = false;
    }

    destroy() {
        this._destroyed = true;

        for (const sourceId of this._retrySourceIds) {
            GLib.source_remove(sourceId);
        }
        this._retrySourceIds.clear();

        if (this._session) {
            this._session.abort();
            this._session = null;
        }
    }

    fetchCopilotInternalUser(token, callback) {
        this._requestWithRetry(`${GITHUB_API_ROOT}/copilot_internal/user`, token, 0, callback);
    }

    _requestWithRetry(url, token, attempt, callback) {
        if (this._destroyed) {
            return;
        }

        this._requestJson(url, token, (error, payload, statusCode, errorCode) => {
            if (!error) {
                callback(null, payload, statusCode, null);
                return;
            }

            if (this._isRetryable(statusCode, errorCode) && attempt < 2) {
                const delayMs = 500 * (2 ** attempt);
                const sourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delayMs, () => {
                    this._retrySourceIds.delete(sourceId);
                    this._requestWithRetry(url, token, attempt + 1, callback);
                    return GLib.SOURCE_REMOVE;
                });
                this._retrySourceIds.add(sourceId);
                return;
            }

            callback(error, null, statusCode, errorCode);
        });
    }

    _requestJson(url, token, callback) {
        const message = Soup.Message.new('GET', url);
        message.request_headers.append('Authorization', `Bearer ${token}`);
        message.request_headers.append('Accept', 'application/vnd.github+json');
        message.request_headers.append('X-GitHub-Api-Version', GITHUB_API_VERSION);
        message.request_headers.append('User-Agent', USER_AGENT);

        this._session.send_and_read_async(
            message,
            GLib.PRIORITY_DEFAULT,
            null,
            (session, result) => {
                if (this._destroyed) {
                    return;
                }

                const statusCode = message.status_code;

                let bytes;
                try {
                    bytes = session.send_and_read_finish(result);
                } catch (e) {
                    callback(new Error('request-failed'), null, statusCode || 0, 'request-failed');
                    return;
                }

                if (statusCode < 200 || statusCode >= 300) {
                    callback(new Error('http-error'), null, statusCode, 'http-error');
                    return;
                }

                try {
                    const decoder = new TextDecoder('utf-8');
                    const payload = JSON.parse(decoder.decode(bytes.get_data()));
                    callback(null, payload, statusCode, null);
                } catch (e) {
                    callback(new Error('invalid-json'), null, statusCode, 'invalid-json');
                }
            }
        );
    }

    _isRetryable(statusCode, errorCode) {
        if (errorCode === 'request-failed') {
            return true;
        }

        if (statusCode === 429) {
            return true;
        }

        if (statusCode >= 500) {
            return true;
        }

        return false;
    }
}
