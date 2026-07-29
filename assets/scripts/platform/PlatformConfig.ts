export const PlatformConfig = {
    // 审核前替换为微信后台创建的正式广告位 ID。
    wechat: {
        rewardedVideoAdUnitId: '',
        interstitialAdUnitId: '',
        bannerAdUnitId: '',
    },
    // 审核前替换为抖音开放平台创建的正式广告位 ID。
    douyin: {
        rewardedVideoAdUnitId: '',
        interstitialAdUnitId: '',
        bannerAdUnitId: '',
    },
    // 开发环境没有配置广告位时，使用可见的模拟流程，便于完整验收奖励链路。
    simulateWhenUnconfigured: true,
};

