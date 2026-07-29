import { sys } from 'cc';
import { PlatformConfig } from './PlatformConfig';

declare const wx: any;
declare const tt: any;

export type AdPlacement = 'hint' | 'preview' | 'settlement';

export interface AdResult {
    rewarded: boolean;
    simulated: boolean;
    reason?: string;
}

export class PlatformAdapter {
    private static _instance: PlatformAdapter;
    static get instance (): PlatformAdapter {
        this._instance ??= new PlatformAdapter();
        return this._instance;
    }

    readonly platform: 'wechat' | 'douyin' | 'web';
    private lastInterstitialAt = 0;
    private bannerAd?: any;
    private readonly adHealth = new Map<string, { failures: number; blockedUntil: number }>();

    private constructor () {
        const globalAny = globalThis as any;
        this.platform = typeof globalAny.wx !== 'undefined'
            ? 'wechat'
            : typeof globalAny.tt !== 'undefined'
                ? 'douyin'
                : 'web';
    }

    async showRewardedVideo (placement: AdPlacement): Promise<AdResult> {
        const cfg = this.platform === 'wechat' ? PlatformConfig.wechat : PlatformConfig.douyin;
        const adUnitId = cfg.rewardedVideoAdUnitId;
        const api = this.platform === 'wechat' ? (globalThis as any).wx : (globalThis as any).tt;

        this.track('ad_entry_view', { placement, type: 'rewarded', platform: this.platform });
        this.track('ad_request', { placement, type: 'rewarded', platform: this.platform });

        if (this.platform === 'web' || !api || !adUnitId) {
            if (!PlatformConfig.simulateWhenUnconfigured) {
                return { rewarded: false, simulated: false, reason: 'unconfigured' };
            }
            await new Promise<void>((resolve) => setTimeout(resolve, 850));
            this.track('ad_result', { placement, result: 'completed', simulated: true });
            return { rewarded: true, simulated: true };
        }

        const healthKey = `rewarded:${placement}`;
        if (this.isAdBlocked(healthKey)) {
            this.track('ad_result', { placement, type: 'rewarded', result: 'circuit-open' });
            return { rewarded: true, simulated: false, reason: 'fallback:circuit-open' };
        }

        return new Promise<AdResult>((resolve) => {
            let settled = false;
            const finish = (result: AdResult) => {
                if (settled) return;
                settled = true;
                if (result.reason?.startsWith('fallback:')) this.recordAdFailure(healthKey);
                else if (result.rewarded) this.resetAdHealth(healthKey);
                this.track('ad_result', { placement, ...result });
                resolve(result);
            };
            try {
                const ad = api.createRewardedVideoAd({ adUnitId });
                ad.onClose((res: any) => finish({ rewarded: res === undefined || !!res.isEnded, simulated: false }));
                ad.onError((err: any) => finish({ rewarded: true, simulated: false, reason: `fallback:${err?.errCode ?? 'error'}` }));
                Promise.resolve(ad.show()).catch(() => ad.load().then(() => ad.show()).catch((err: any) => {
                    finish({ rewarded: true, simulated: false, reason: `fallback:${err?.errCode ?? 'no-fill'}` });
                }));
                setTimeout(() => finish({ rewarded: true, simulated: false, reason: 'fallback:timeout' }), 5000);
            } catch (error) {
                finish({ rewarded: true, simulated: false, reason: 'fallback:exception' });
            }
        });
    }

    async showInterstitialIfAllowed (completedCount: number): Promise<void> {
        if (completedCount <= 3 || completedCount % 3 !== 0) return;
        const now = Date.now();
        if (now - this.lastInterstitialAt < 120_000) return;

        const cfg = this.platform === 'wechat' ? PlatformConfig.wechat : PlatformConfig.douyin;
        const adUnitId = cfg.interstitialAdUnitId;
        const api = this.platform === 'wechat' ? (globalThis as any).wx : (globalThis as any).tt;
        if (!api || !adUnitId || typeof api.createInterstitialAd !== 'function') return;

        try {
            this.lastInterstitialAt = now;
            const ad = api.createInterstitialAd({ adUnitId });
            await ad.show();
            this.track('ad_result', { placement: 'settlement', type: 'interstitial', result: 'shown' });
        } catch (error) {
            this.track('ad_result', { placement: 'settlement', type: 'interstitial', result: 'failed' });
        }
    }

    async showBanner (placement: 'home' | 'settlement'): Promise<void> {
        const cfg = this.platform === 'wechat' ? PlatformConfig.wechat : PlatformConfig.douyin;
        const api = this.platform === 'wechat' ? (globalThis as any).wx : (globalThis as any).tt;
        if (!api || !cfg.bannerAdUnitId || typeof api.createBannerAd !== 'function') {
            this.track('ad_result', { placement, type: 'banner', result: 'placeholder' });
            return;
        }

        if (this.bannerAd) {
            try {
                await this.bannerAd.show();
                this.track('ad_result', { placement, type: 'banner', result: 'shown' });
            } catch {
                this.track('ad_result', { placement, type: 'banner', result: 'failed' });
            }
            return;
        }

        try {
            const system = api.getSystemInfoSync?.() ?? { windowWidth: 375, windowHeight: 667 };
            const minWidth = this.platform === 'wechat' ? 300 : Math.floor(system.windowWidth * 0.8);
            const width = Math.min(system.windowWidth, Math.max(minWidth, 320));
            const ad = api.createBannerAd({
                adUnitId: cfg.bannerAdUnitId,
                adIntervals: 60,
                style: {
                    left: Math.max(0, (system.windowWidth - width) / 2),
                    top: Math.max(0, system.windowHeight - 100),
                    width,
                },
            });
            this.bannerAd = ad;
            ad.onResize?.((size: { width: number; height: number }) => {
                ad.style.left = Math.max(0, (system.windowWidth - size.width) / 2);
                ad.style.top = Math.max(0, system.windowHeight - size.height);
            });
            ad.onError?.((error: any) => {
                this.track('ad_result', { placement, type: 'banner', result: 'failed', code: error?.errCode });
            });
            await ad.show();
            this.track('ad_result', { placement, type: 'banner', result: 'shown' });
        } catch {
            this.track('ad_result', { placement, type: 'banner', result: 'failed' });
        }
    }

    hideBanner (): void {
        try {
            this.bannerAd?.hide?.();
        } catch {
            // 页面切换时隐藏失败不应阻断游戏流程。
        }
    }

    share (title: string, imageUrl?: string): void {
        const api = this.platform === 'wechat' ? (globalThis as any).wx : (globalThis as any).tt;
        if (api?.shareAppMessage) {
            api.shareAppMessage({ title, imageUrl });
            return;
        }
        this.track('share_result', { platform: this.platform, success: false, reason: 'preview' });
    }

    vibrateShort (): void {
        const api = this.platform === 'wechat' ? (globalThis as any).wx : (globalThis as any).tt;
        try {
            api?.vibrateShort?.({ type: 'light' });
        } catch {
            // 震动是辅助反馈，能力缺失时静默降级。
        }
    }

    async openFeedback (): Promise<boolean> {
        const api = this.platform === 'wechat' ? (globalThis as any).wx : (globalThis as any).tt;
        try {
            if (typeof api?.openCustomerServiceConversation === 'function') {
                await api.openCustomerServiceConversation({});
                return true;
            }
        } catch {
            // 继续使用统一的失败埋点和页面提示。
        }
        this.track('feedback_open', { platform: this.platform, success: false, reason: 'unconfigured' });
        return false;
    }

    private isAdBlocked (key: string): boolean {
        const state = this.adHealth.get(key);
        if (!state) return false;
        if (state.blockedUntil > Date.now()) return true;
        if (state.blockedUntil) this.adHealth.delete(key);
        return false;
    }

    private recordAdFailure (key: string): void {
        const state = this.adHealth.get(key) ?? { failures: 0, blockedUntil: 0 };
        state.failures += 1;
        if (state.failures >= 2) {
            state.failures = 0;
            state.blockedUntil = Date.now() + 10 * 60_000;
        }
        this.adHealth.set(key, state);
    }

    private resetAdHealth (key: string): void {
        this.adHealth.delete(key);
    }

    track (event: string, params: Record<string, unknown> = {}): void {
        // 接入正式数据 SDK 时在此统一转发；开发态保留控制台日志。
        console.info(`[analytics] ${event}`, params);
    }
}
