import {
    _decorator,
    Button,
    Color,
    Component,
    EventTouch,
    game,
    Graphics,
    Label,
    Mask,
    Node,
    profiler,
    ResolutionPolicy,
    resources,
    Sprite,
    SpriteFrame,
    sys,
    UITransform,
    Vec3,
    view,
} from 'cc';
import { PlatformAdapter } from './platform/PlatformAdapter';

const { ccclass } = _decorator;

type PuzzleId = 'panda' | 'great-wall' | 'tiananmen';

interface PuzzleDefinition {
    id: PuzzleId;
    title: string;
    subtitle: string;
    path: string;
    accent: Color;
}

interface PieceState {
    index: number;
    x: number;
    y: number;
    solved: boolean;
}

interface SaveData {
    version: 1 | 2;
    puzzleId: PuzzleId;
    difficulty: number;
    startedAt: number;
    elapsedSeconds: number;
    freeHints: number;
    hintAdsUsed?: number;
    previewAdUsed?: boolean;
    isDaily?: boolean;
    pieces: PieceState[];
}

interface UserState {
    version: 1;
    lastDifficulty: number;
    favorites: PuzzleId[];
    completed: Partial<Record<PuzzleId, number>>;
    dailyStamps: string[];
}

interface AccessibilitySettings {
    version: 1;
    sound: boolean;
    vibration: boolean;
    reduceMotion: boolean;
    highContrast: boolean;
}

interface PreviewUsage {
    date: string;
    freeUsed: number;
}

interface RuntimePiece {
    node: Node;
    index: number;
    target: Vec3;
    solved: boolean;
}

type JigsawEdge = -1 | 0 | 1;

interface JigsawEdges {
    top: JigsawEdge;
    right: JigsawEdge;
    bottom: JigsawEdge;
    left: JigsawEdge;
}

const COLORS = {
    ink: new Color(24, 50, 73, 255),
    blue: new Color(34, 89, 130, 255),
    paper: new Color(247, 244, 236, 255),
    jade: new Color(65, 130, 104, 255),
    vermilion: new Color(180, 56, 49, 255),
    gold: new Color(193, 137, 48, 255),
    white: new Color(255, 255, 255, 255),
    muted: new Color(95, 105, 116, 255),
    border: new Color(215, 220, 222, 255),
};

const SAVE_KEY = 'huaxia-puzzle-save-v1';
const COMPLETE_KEY = 'huaxia-puzzle-complete-count';
const USER_KEY = 'huaxia-puzzle-user-v1';
const SETTINGS_KEY = 'huaxia-puzzle-settings-v1';
const PREVIEW_KEY = 'huaxia-puzzle-preview-v1';
const ALLOWED_DIFFICULTIES = [12, 24, 48, 80] as const;

@ccclass('PuzzleApp')
export class PuzzleApp extends Component {
    private readonly puzzles: PuzzleDefinition[] = [
        { id: 'panda', title: '竹林熊猫', subtitle: '国宝熊猫 · 治愈推荐', path: 'images/panda/spriteFrame', accent: COLORS.jade },
        { id: 'great-wall', title: '晨曦长城', subtitle: '中华名胜 · 今日推荐', path: 'images/great-wall/spriteFrame', accent: COLORS.gold },
        { id: 'tiananmen', title: '天安门晨光', subtitle: '中华名胜 · 城市印象', path: 'images/tiananmen/spriteFrame', accent: COLORS.vermilion },
    ];

    private appRoot!: Node;
    private overlay?: Node;
    private currentPuzzle?: PuzzleDefinition;
    private currentDifficulty = 12;
    private currentSpriteFrame?: SpriteFrame;
    private runtimePieces: RuntimePiece[] = [];
    private board?: Node;
    private previewSprite?: Sprite;
    private statusLabel?: Label;
    private startedAt = 0;
    private elapsedBeforeStart = 0;
    private freeHints = 1;
    private hintAdsUsed = 0;
    private lastHintAdAt = 0;
    private previewAdUsed = false;
    private previewing = false;
    private isDaily = false;
    private completedElapsed = 0;
    private landscapeMode = false;
    private layoutWidth = 960;
    private safeLeft = 0;
    private safeRight = 0;
    private safeTop = 0;
    private safeBottom = 0;
    private boardWidth = 640;
    private boardHeight = 480;
    private boardCenterX = -40;
    private trayLocalX = 435;
    private finished = false;
    private userState: UserState = {
        version: 1,
        lastDifficulty: 12,
        favorites: [],
        completed: {},
        dailyStamps: [],
    };
    private settings: AccessibilitySettings = {
        version: 1,
        sound: true,
        vibration: true,
        reduceMotion: false,
        highContrast: false,
    };

    onLoad (): void {
        profiler.hideStats();
        view.resizeWithBrowserSize(true);
        this.appRoot = new Node('AppRoot');
        this.node.addChild(this.appRoot);
        this.userState = this.readJson(USER_KEY, this.userState);
        this.settings = this.readJson(SETTINGS_KEY, this.settings);
        game.on(game.EVENT_HIDE, this.handleAppHide, this);
        const directPreview = sys.isBrowser
            && typeof window !== 'undefined'
            && new URLSearchParams(window.location.search).has('inspect');
        if (directPreview) {
            this.startPuzzle(this.puzzles[0], 12);
        } else {
            this.showHome();
        }
        PlatformAdapter.instance.track('app_launch', { platform: PlatformAdapter.instance.platform });
    }

    onDestroy (): void {
        game.off(game.EVENT_HIDE, this.handleAppHide, this);
        this.saveProgress();
    }

    private clearRoot (): void {
        this.closeOverlay();
        this.unschedule(this.refreshStatus);
        this.unschedule(this.autoSave);
        this.runtimePieces = [];
        this.appRoot.removeAllChildren();
    }

    private showHome (): void {
        this.setLayout(false);
        this.clearRoot();
        this.finished = false;
        const contentLeft = -this.layoutWidth / 2 + this.safeLeft + 28;
        const contentRight = this.layoutWidth / 2 - this.safeRight - 28;
        const contentWidth = contentRight - contentLeft;
        this.drawRect(this.appRoot, this.layoutWidth, 600, COLORS.paper);

        this.makeLabel(this.appRoot, '巧拼雅集', 38, COLORS.ink, new Vec3(contentLeft + 120, 246 - this.safeTop), 240, 'left', true);
        this.makeLabel(this.appRoot, '每日一幅中国之美', 18, COLORS.muted, new Vec3(contentLeft + 168, 208 - this.safeTop), 336, 'left');
        this.makePill(this.appRoot, `运行于 ${this.platformName()}`, new Vec3(contentRight - 300, 242 - this.safeTop), COLORS.blue);
        this.makeButton(this.appRoot, this.isTodayStamped() ? '今日 ✓' : '每日拼图', new Vec3(contentRight - 112, 242 - this.safeTop), 150, 46, COLORS.vermilion, () => this.showDaily());
        this.makeButton(this.appRoot, '设置', new Vec3(contentRight - 38, 188 - this.safeTop), 92, 44, COLORS.ink, () => this.showSettings());

        const saved = this.readSave();
        let cardsY = -42;
        if (saved) {
            const def = this.puzzles.find((item) => item.id === saved.puzzleId);
            const resume = this.makeButton(this.appRoot, `继续：${def?.title ?? '上次拼图'} · ${saved.difficulty}片`, new Vec3(0, 157), Math.min(620, contentWidth), 54, COLORS.ink, () => {
                if (def) this.startPuzzle(def, saved.difficulty, saved);
            });
            this.makeLabel(resume, '已自动保存', 13, new Color(220, 228, 236), new Vec3(215, 0), 120, 'center');
            cardsY = -70;
        }

        this.makeLabel(this.appRoot, '精选图库', 25, COLORS.ink, new Vec3(contentLeft + 90, cardsY + 155), 180, 'left', true);
        const gap = 16;
        const cardWidth = Math.min(360, (contentWidth - gap * 2) / 3);
        const cardsWidth = cardWidth * 3 + gap * 2;
        const cardsLeft = -cardsWidth / 2 + cardWidth / 2;
        this.puzzles.forEach((puzzle, index) => this.makePuzzleCard(puzzle, cardsLeft + index * (cardWidth + gap), cardsY, cardWidth));
        this.makeAdPlaceholder(this.appRoot, new Vec3(0, -262 + this.safeBottom));
        void PlatformAdapter.instance.showBanner('home');
        PlatformAdapter.instance.track('home_view', { hasResume: !!saved });
    }

    private makePuzzleCard (puzzle: PuzzleDefinition, x: number, y: number, width: number): void {
        const card = this.makePanel(this.appRoot, width, 290, new Vec3(x, y), COLORS.white, 20);
        const imageWidth = width - 20;
        const imageNode = this.makeNode('Cover', card, imageWidth, 126, new Vec3(0, 68));
        this.drawRect(imageNode, imageWidth, 126, new Color(puzzle.accent.r, puzzle.accent.g, puzzle.accent.b, 45), 15);
        resources.load(puzzle.path, SpriteFrame, (error, frame) => {
            if (error || !imageNode.isValid) return;
            const sprite = imageNode.addComponent(Sprite);
            sprite.spriteFrame = frame;
            sprite.sizeMode = Sprite.SizeMode.CUSTOM;
            imageNode.getComponent(UITransform)!.setContentSize(imageWidth, 126);
        });

        this.makeLabel(card, puzzle.title, 23, COLORS.ink, new Vec3(0, -12), width - 28, 'left', true);
        this.makeLabel(card, puzzle.subtitle, 14, COLORS.muted, new Vec3(0, -42), width - 28, 'left');
        const stateText = `${this.userState.favorites.includes(puzzle.id) ? '★ 已收藏' : '☆ 可收藏'}${this.userState.completed[puzzle.id] ? ` · 已完成 ${this.userState.completed[puzzle.id]} 次` : ''}`;
        this.makeLabel(card, stateText, 12, puzzle.accent, new Vec3(0, -68), width - 28, 'left', true);
        const buttonWidth = Math.max(106, width * 0.46);
        const button = this.makeButton(card, '选择难度', new Vec3(width / 2 - buttonWidth / 2 - 12, -112), buttonWidth, 44, puzzle.accent, () => this.showDifficulty(puzzle));
        this.makeLabel(card, '12 · 24 · 48 · 80', 12, puzzle.accent, new Vec3(-width * 0.23, -112), width * 0.45, 'center', true);
        card.on(Node.EventType.TOUCH_END, () => this.showDifficulty(puzzle));
        button.on(Node.EventType.TOUCH_END, (event: EventTouch) => event.propagationStopped = true);
    }

    private showDifficulty (puzzle: PuzzleDefinition): void {
        PlatformAdapter.instance.track('puzzle_select', {
            puzzleId: puzzle.id,
            theme: puzzle.subtitle.split(' · ')[0],
            completedBefore: !!this.userState.completed[puzzle.id],
        });
        this.closeOverlay();
        const layer = this.makeOverlay();
        const modal = this.makePanel(layer, 610, 470, new Vec3(0, -40), COLORS.white, 26);
        this.makeLabel(modal, puzzle.title, 32, COLORS.ink, new Vec3(0, 160), 520, 'center', true);
        this.makeLabel(modal, '选择碎片数量', 20, COLORS.muted, new Vec3(0, 115), 520, 'center');
        ALLOWED_DIFFICULTIES.forEach((difficulty, index) => {
            const x = index % 2 === 0 ? -145 : 145;
            const y = index < 2 ? 38 : -56;
            const subtitle = difficulty <= 24 ? '轻松' : difficulty === 48 ? '标准' : '挑战';
            const selected = difficulty === this.userState.lastDifficulty;
            const btn = this.makeButton(modal, `${selected ? '✓ ' : ''}${difficulty} 片`, new Vec3(x, y), 250, 78, selected ? COLORS.ink : puzzle.accent, () => this.startPuzzle(puzzle, difficulty));
            this.makeLabel(btn, subtitle, 13, new Color(255, 255, 255, 190), new Vec3(78, -20), 70, 'center');
        });
        this.makeButton(modal, '取消', new Vec3(0, -160), 180, 48, COLORS.muted, () => this.closeOverlay());
    }

    private showDaily (): void {
        const daily = this.dailyPuzzle();
        const stamped = this.isTodayStamped();
        const layer = this.makeOverlay();
        const modal = this.makePanel(layer, 610, 470, new Vec3(0, -30), COLORS.white, 26);
        this.makeLabel(modal, '每日拼图', 34, COLORS.vermilion, new Vec3(0, 165), 520, 'center', true);
        this.makeLabel(modal, this.beijingDate(), 17, COLORS.muted, new Vec3(0, 120), 520, 'center');
        this.makeLabel(modal, daily.title, 30, COLORS.ink, new Vec3(0, 65), 520, 'center', true);
        this.makeLabel(modal, stamped ? '今日印章已获得，可继续重玩' : '完成 12 片拼图，点亮今日印章', 18, stamped ? COLORS.jade : COLORS.muted, new Vec3(0, 18), 520, 'center', true);
        this.makeButton(modal, stamped ? '重玩今日拼图' : '开始今日拼图', new Vec3(0, -72), 430, 64, daily.accent, () => this.startPuzzle(daily, 12, undefined, true));
        this.makeButton(modal, '返回', new Vec3(0, -160), 200, 48, COLORS.ink, () => this.closeOverlay());
        PlatformAdapter.instance.track('daily_view', { date: this.beijingDate(), stamped, puzzleId: daily.id });
    }

    private showSettings (): void {
        const layer = this.makeOverlay();
        const modal = this.makePanel(layer, 720, 540, new Vec3(0, 0), COLORS.white, 26);
        this.makeLabel(modal, '设置与帮助', 32, COLORS.ink, new Vec3(0, 220), 600, 'center', true);
        const options: Array<[keyof Omit<AccessibilitySettings, 'version'>, string, number]> = [
            ['sound', '音效', 155],
            ['vibration', '震动', 92],
            ['reduceMotion', '减少动画', 29],
            ['highContrast', '高对比拼片轮廓', -34],
        ];
        options.forEach(([key, title, y]) => {
            const enabled = this.settings[key];
            this.makeLabel(modal, title, 20, COLORS.ink, new Vec3(-155, y), 280, 'left', true);
            this.makeButton(modal, enabled ? '已开启' : '已关闭', new Vec3(175, y), 180, 52, enabled ? COLORS.jade : COLORS.muted, () => {
                this.settings[key] = !this.settings[key];
                this.writeJson(SETTINGS_KEY, this.settings);
                this.showSettings();
            });
        });
        this.makeButton(modal, '隐私与用户协议', new Vec3(-145, -108), 260, 50, COLORS.blue, () => this.showPolicy());
        this.makeButton(modal, '联系客服 / 反馈', new Vec3(145, -108), 260, 50, COLORS.vermilion, () => {
            void PlatformAdapter.instance.openFeedback().then((opened) => {
                this.toast(opened ? '已打开客服入口' : '反馈入口将在正式平台配置后启用');
            });
        });
        this.makeLabel(modal, '广告仅用于附加提示和自然结算，不影响基础关卡与奖励。', 14, COLORS.muted, new Vec3(0, -171), 600, 'center');
        this.makeButton(modal, '完成', new Vec3(0, -222), 220, 46, COLORS.ink, () => this.closeOverlay());
    }

    private showPolicy (): void {
        const layer = this.makeOverlay();
        const modal = this.makePanel(layer, 720, 520, new Vec3(0, 0), COLORS.white, 26);
        this.makeLabel(modal, '隐私与用户协议', 30, COLORS.ink, new Vec3(0, 205), 620, 'center', true);
        const content = [
            '本游戏仅保存完成拼图所需的本地进度、收藏、设置和匿名运行事件。',
            '平台登录、广告与客服能力仅在用户主动触发时调用，并遵循微信/抖音平台规则。',
            '不会开放用户上传图片；正式上线前将在此接入完整隐私政策、用户协议与第三方 SDK 清单。',
        ].join('\n\n');
        const label = this.makeLabel(modal, content, 17, COLORS.muted, new Vec3(0, 30), 620, 'left');
        label.overflow = Label.Overflow.RESIZE_HEIGHT;
        this.makeButton(modal, '返回设置', new Vec3(0, -205), 240, 50, COLORS.ink, () => this.showSettings());
    }

    private showGameMenu (): void {
        const layer = this.makeOverlay();
        const modal = this.makePanel(layer, 540, 480, new Vec3(0, 0), new Color(244, 246, 255), 24);
        this.makeLabel(modal, '拼图菜单', 32, COLORS.ink, new Vec3(0, 185), 460, 'center', true);
        this.makeLabel(modal, this.currentPuzzle?.title ?? '', 18, COLORS.muted, new Vec3(0, 145), 460, 'center');
        this.makeButton(modal, '继续拼图', new Vec3(0, 82), 430, 54, COLORS.blue, () => this.closeOverlay());
        this.makeButton(modal, this.freeHints > 0 ? '使用提示' : '广告提示', new Vec3(-112, 12), 200, 52, COLORS.jade, () => {
            this.closeOverlay();
            void this.requestHint();
        });
        this.makeButton(modal, '原图预览', new Vec3(112, 12), 200, 52, COLORS.gold, () => {
            this.closeOverlay();
            void this.previewImage();
        });
        this.makeButton(modal, '拼片放回托盘', new Vec3(0, -58), 430, 52, new Color(75, 87, 166), () => {
            this.closeOverlay();
            this.resetUnsolved();
        });
        this.makeButton(modal, '保存并退出', new Vec3(0, -135), 430, 52, COLORS.vermilion, () => {
            this.saveProgress();
            PlatformAdapter.instance.track('puzzle_exit', {
                puzzleId: this.currentPuzzle?.id,
                progressPct: this.progressPercent(),
                duration: this.elapsedSeconds(),
                reason: 'menu',
            });
            this.showHome();
        });
    }

    private setLayout (_landscape: boolean): void {
        this.landscapeMode = true;
        this.updateDeviceMetrics();
        const width = this.layoutWidth;
        const height = 600;
        view.setDesignResolutionSize(width, height, ResolutionPolicy.FIXED_HEIGHT);
        const canvasTransform = this.node.getComponent(UITransform) ?? this.node.addComponent(UITransform);
        canvasTransform.setContentSize(width, height);
    }

    private updateDeviceMetrics (): void {
        const globalAny = globalThis as any;
        const platformApi = globalAny.wx ?? globalAny.tt;
        const info = platformApi?.getWindowInfo?.() ?? platformApi?.getSystemInfoSync?.();
        const frame = view.getFrameSize();
        const browserWidth = globalAny.window?.innerWidth;
        const browserHeight = globalAny.window?.innerHeight;
        const rawWidth = Number(info?.windowWidth ?? browserWidth ?? frame.width ?? 960);
        const rawHeight = Number(info?.windowHeight ?? browserHeight ?? frame.height ?? 600);
        const landscapeWidth = Math.max(rawWidth, rawHeight);
        const landscapeHeight = Math.max(1, Math.min(rawWidth, rawHeight));
        this.layoutWidth = Math.max(800, Math.min(1320, 600 * landscapeWidth / landscapeHeight));

        this.safeLeft = 0;
        this.safeRight = 0;
        this.safeTop = 0;
        this.safeBottom = 0;
        const safe = info?.safeArea;
        if (safe && rawWidth >= rawHeight) {
            const scale = 600 / rawHeight;
            this.safeLeft = Math.max(0, safe.left * scale);
            this.safeRight = Math.max(0, (rawWidth - safe.right) * scale);
            this.safeTop = Math.max(0, safe.top * scale);
            this.safeBottom = Math.max(0, (rawHeight - safe.bottom) * scale);
        }
    }

    private startPuzzle (puzzle: PuzzleDefinition, difficulty: number, saved?: SaveData, daily = false): void {
        PlatformAdapter.instance.hideBanner();
        this.closeOverlay();
        this.setLayout(true);
        this.currentPuzzle = puzzle;
        this.currentDifficulty = difficulty;
        this.userState.lastDifficulty = difficulty;
        this.writeJson(USER_KEY, this.userState);
        this.finished = false;
        this.startedAt = Date.now();
        this.elapsedBeforeStart = saved?.elapsedSeconds ?? 0;
        this.freeHints = saved?.freeHints ?? 1;
        this.hintAdsUsed = saved?.hintAdsUsed ?? 0;
        this.previewAdUsed = saved?.previewAdUsed ?? false;
        this.previewing = false;
        this.isDaily = saved?.isDaily ?? daily;
        this.completedElapsed = 0;
        this.clearRoot();
        const contentLeft = -this.layoutWidth / 2 + this.safeLeft;
        const contentRight = this.layoutWidth / 2 - this.safeRight;
        const usableWidth = contentRight - contentLeft;
        const sideBarWidth = Math.max(150, Math.min(190, usableWidth * 0.19));
        const gameRight = contentRight - sideBarWidth;
        const gameWidth = gameRight - contentLeft;
        this.boardWidth = Math.max(540, Math.min(640, gameWidth - 24));
        this.boardHeight = Math.min(480, this.boardWidth * 0.75);
        this.boardCenterX = contentLeft + gameWidth / 2;
        const sideBarCenterX = gameRight + sideBarWidth / 2;
        this.trayLocalX = sideBarCenterX - this.boardCenterX;

        this.drawRect(this.appRoot, this.layoutWidth, 600, new Color(22, 35, 122));
        const sideBar = this.makePanel(this.appRoot, sideBarWidth, 600, new Vec3(sideBarCenterX, 0), new Color(114, 130, 198), 0);
        this.makeLabel(sideBar, '待拼区', 18, new Color(235, 239, 255), new Vec3(0, 268 - this.safeTop), sideBarWidth - 20, 'center', true);

        this.makeButton(this.appRoot, '☰', new Vec3(contentLeft + 48, 250 - this.safeTop), 86, 76, new Color(42, 53, 145), () => this.showGameMenu());
        this.makeLabel(this.appRoot, `巧拼雅集 · ${puzzle.title}`, 22, new Color(232, 237, 255), new Vec3(contentLeft + 245, 260 - this.safeTop), 350, 'left', true);
        this.statusLabel = this.makeLabel(this.appRoot, '', 16, new Color(205, 213, 255), new Vec3(gameRight - 104, 260 - this.safeTop), 190, 'right');
        this.makeLabel(this.appRoot, '拖动右侧拼片到中央棋盘', 14, new Color(180, 192, 244), new Vec3(this.boardCenterX, -278 + this.safeBottom), 420, 'center');
        resources.load(puzzle.path, SpriteFrame, (error, frame) => {
            if (error) {
                this.toast('图片加载失败，请返回重试');
                return;
            }
            this.currentSpriteFrame = frame;
            this.createBoard(frame, saved);
            PlatformAdapter.instance.track('puzzle_start', { puzzleId: puzzle.id, difficulty });
        });
        this.schedule(this.refreshStatus, 1);
        this.schedule(this.autoSave, 15);
    }

    private createBoard (frame: SpriteFrame, saved?: SaveData): void {
        const boardW = this.boardWidth;
        const boardH = this.boardHeight;
        this.board = this.makePanel(this.appRoot, boardW, boardH, new Vec3(this.boardCenterX, 5), new Color(27, 42, 137), 0);

        const previewNode = this.makeNode('Preview', this.board, boardW, boardH, Vec3.ZERO);
        this.previewSprite = previewNode.addComponent(Sprite);
        this.previewSprite.spriteFrame = frame;
        this.previewSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        previewNode.getComponent(UITransform)!.setContentSize(boardW, boardH);
        this.previewSprite.color = new Color(255, 255, 255, 10);

        const [cols, rows] = this.gridFor(this.currentDifficulty);
        const pieceW = boardW / cols;
        const pieceH = boardH / rows;
        const tabDepth = Math.min(pieceW, pieceH) * 0.26;
        this.drawBoardGrid(this.board, boardW, boardH, cols, rows);
        this.makePreviewThumbnail(frame);
        const saveByIndex = new Map((saved?.pieces ?? []).map((piece) => [piece.index, piece]));
        const pieceOrder = this.seededShuffle(Array.from({ length: cols * rows }, (_, i) => i), this.hash(`${this.currentPuzzle?.id}-${this.currentDifficulty}-tray`));

        for (let index = 0; index < cols * rows; index++) {
            const col = index % cols;
            const row = Math.floor(index / cols);
            const target = new Vec3(-boardW / 2 + pieceW / 2 + col * pieceW, boardH / 2 - pieceH / 2 - row * pieceH);
            const pieceNode = this.makeNode(`Piece-${index}`, this.board, pieceW + tabDepth * 2, pieceH + tabDepth * 2, target);
            const edges = this.jigsawEdges(col, row, cols, rows);

            const mask = pieceNode.addComponent(Mask);
            mask.type = Mask.Type.GRAPHICS_STENCIL;
            this.drawJigsawShape(mask.graphics, pieceW, pieceH, tabDepth, edges, true);

            const imageNode = this.makeNode('PieceImage', pieceNode, boardW, boardH, new Vec3(-target.x, -target.y));
            const sprite = imageNode.addComponent(Sprite);
            sprite.spriteFrame = frame;
            sprite.sizeMode = Sprite.SizeMode.CUSTOM;
            imageNode.getComponent(UITransform)!.setContentSize(boardW, boardH);

            const bevelShadow = new Node('BevelShadow');
            pieceNode.addChild(bevelShadow);
            bevelShadow.setPosition(1.5, -1.5);
            const shadowGraphics = bevelShadow.addComponent(Graphics);
            shadowGraphics.strokeColor = new Color(24, 50, 73, this.settings.highContrast ? 180 : 90);
            shadowGraphics.lineWidth = this.settings.highContrast ? 5 : 3;
            this.drawJigsawShape(shadowGraphics, pieceW, pieceH, tabDepth, edges, false);

            const border = new Node('Border');
            pieceNode.addChild(border);
            const borderGraphics = border.addComponent(Graphics);
            borderGraphics.strokeColor = this.settings.highContrast ? new Color(255, 213, 79, 255) : new Color(255, 255, 255, 195);
            borderGraphics.lineWidth = this.settings.highContrast ? 3 : this.currentDifficulty >= 48 ? 1 : 2;
            this.drawJigsawShape(borderGraphics, pieceW, pieceH, tabDepth, edges, false);

            const state = saveByIndex.get(index);
            const trayOrder = pieceOrder.indexOf(index);
            const trayPosition = this.trayPosition(trayOrder, boardW, boardH);
            const solved = state?.solved ?? false;
            pieceNode.setPosition(solved ? target : state ? new Vec3(state.x, state.y) : trayPosition);
            const inTray = !solved && (state ? state.x > boardW / 2 + 20 : true);
            const trayScale = Math.min(1, 88 / Math.max(pieceW, pieceH));
            pieceNode.setScale(inTray ? trayScale : 1, inTray ? trayScale : 1, 1);
            if (solved) pieceNode.setSiblingIndex(index);

            const runtime: RuntimePiece = { node: pieceNode, index, target, solved };
            this.bindPiece(runtime, pieceW, pieceH);
            this.runtimePieces.push(runtime);
        }
        this.refreshStatus();
    }

    private drawBoardGrid (board: Node, width: number, height: number, cols: number, rows: number): void {
        const grid = new Node('BoardGrid');
        board.addChild(grid);
        const graphics = grid.addComponent(Graphics);
        graphics.strokeColor = new Color(74, 89, 178, 125);
        graphics.lineWidth = 1.5;
        for (let col = 1; col < cols; col++) {
            const x = -width / 2 + col * width / cols;
            graphics.moveTo(x, -height / 2);
            graphics.lineTo(x, height / 2);
        }
        for (let row = 1; row < rows; row++) {
            const y = -height / 2 + row * height / rows;
            graphics.moveTo(-width / 2, y);
            graphics.lineTo(width / 2, y);
        }
        graphics.stroke();
    }

    private makePreviewThumbnail (frame: SpriteFrame): void {
        const width = Math.max(176, Math.min(224, this.boardWidth * 0.35));
        const height = width * 0.76;
        const x = -this.layoutWidth / 2 + this.safeLeft + width / 2 + 10;
        const y = -300 + this.safeBottom + height / 2 + 20;
        const frameNode = this.makePanel(this.appRoot, width, height, new Vec3(x, y), new Color(232, 237, 255), 4);
        const imageNode = this.makeNode('OriginalThumbnail', frameNode, width - 10, height - 10, Vec3.ZERO);
        const sprite = imageNode.addComponent(Sprite);
        sprite.spriteFrame = frame;
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        imageNode.getComponent(UITransform)!.setContentSize(width - 10, height - 10);
        const border = imageNode.addComponent(Graphics);
        border.strokeColor = new Color(255, 255, 255, 220);
        border.lineWidth = 2;
        border.rect(-(width - 10) / 2, -(height - 10) / 2, width - 10, height - 10);
        border.stroke();
        frameNode.setSiblingIndex(this.appRoot.children.length - 1);
    }

    private trayPosition (index: number, boardWidth: number, boardHeight: number): Vec3 {
        const slot = index % 5;
        const y = boardHeight / 2 - 46 - slot * ((boardHeight - 92) / 4);
        return new Vec3(this.trayLocalX, y);
    }

    private bindPiece (piece: RuntimePiece, pieceW: number, pieceH: number): void {
        piece.node.on(Node.EventType.TOUCH_START, () => {
            if (!piece.solved) {
                piece.node.setScale(1, 1, 1);
                piece.node.setSiblingIndex(this.board!.children.length - 1);
            }
        });
        piece.node.on(Node.EventType.TOUCH_MOVE, (event: EventTouch) => {
            if (piece.solved || this.finished) return;
            const delta = event.getUIDelta();
            piece.node.setPosition(piece.node.position.x + delta.x, piece.node.position.y + delta.y);
        });
        piece.node.on(Node.EventType.TOUCH_END, () => {
            if (piece.solved || this.finished) return;
            const dx = piece.node.position.x - piece.target.x;
            const dy = piece.node.position.y - piece.target.y;
            const threshold = Math.max(15, Math.min(pieceW, pieceH) * 0.42);
            if (Math.hypot(dx, dy) <= threshold) this.solvePiece(piece);
            else this.saveProgress();
        });
        piece.node.on(Node.EventType.TOUCH_CANCEL, () => this.saveProgress());
    }

    private solvePiece (piece: RuntimePiece): void {
        piece.solved = true;
        piece.node.setScale(1, 1, 1);
        piece.node.setPosition(piece.target);
        piece.node.setSiblingIndex(piece.index);
        PlatformAdapter.instance.track('piece_snap', {
            puzzleId: this.currentPuzzle?.id,
            difficulty: this.currentDifficulty,
            solved: this.runtimePieces.filter((item) => item.solved).length,
        });
        this.saveProgress();
        if (this.settings.vibration) PlatformAdapter.instance.vibrateShort();
        this.refreshStatus();
        if (this.runtimePieces.every((item) => item.solved)) this.completePuzzle();
    }

    private async requestHint (): Promise<void> {
        if (this.finished) return;
        if (this.freeHints > 0) {
            this.freeHints -= 1;
            this.applyHint('free');
            return;
        }
        const confirmed = await this.confirm('观看激励视频', '看完视频可自动放好 1 片。广告加载失败时本次免费获得提示。', '观看视频');
        if (!confirmed) return;
        const now = Date.now();
        if (this.hintAdsUsed >= 2) {
            this.toast('本局广告提示已达 2 次上限');
            return;
        }
        if (this.lastHintAdAt && now - this.lastHintAdAt < 60_000) {
            this.toast('提示视频需间隔 60 秒');
            return;
        }
        this.lastHintAdAt = now;
        this.toast('正在加载视频…');
        const result = await PlatformAdapter.instance.showRewardedVideo('hint');
        if (result.rewarded) {
            this.hintAdsUsed += 1;
            this.applyHint(result.simulated ? 'simulated-ad' : 'ad');
            this.toast(result.simulated ? '开发环境：已模拟完整观看' : '提示已到账');
            PlatformAdapter.instance.track('reward_grant', { placement: 'hint', rewardType: 'piece', idempotentResult: 'granted' });
        } else {
            this.toast('需完整观看视频才能获得提示');
        }
    }

    private applyHint (source: string): void {
        const piece = this.runtimePieces.find((item) => !item.solved);
        if (!piece) return;
        this.solvePiece(piece);
        PlatformAdapter.instance.track('hint_use', { source, puzzleId: this.currentPuzzle?.id });
    }

    private async previewImage (): Promise<void> {
        if (!this.previewSprite || this.finished || this.previewing) return;
        const usage = this.readPreviewUsage();
        if (usage.freeUsed < 2) {
            usage.freeUsed += 1;
            this.writeJson(PREVIEW_KEY, usage);
            await this.showPreview(3);
            return;
        }
        if (this.previewAdUsed) {
            this.toast('本局激励预览已使用');
            return;
        }
        const confirmed = await this.confirm('观看激励视频', '今日免费预览已用完，看完视频可预览完整原图 15 秒。加载失败时仍可免费预览。', '观看视频');
        if (!confirmed) return;
        this.toast('正在加载视频…');
        const result = await PlatformAdapter.instance.showRewardedVideo('preview');
        if (!result.rewarded) {
            this.toast('需完整观看视频才能获得长预览');
            return;
        }
        this.previewAdUsed = true;
        PlatformAdapter.instance.track('reward_grant', { placement: 'preview', rewardType: 'preview15s', idempotentResult: 'granted' });
        await this.showPreview(15);
    }

    private async showPreview (seconds: number): Promise<void> {
        const preview = this.previewSprite;
        const board = this.board;
        if (!preview || !board) return;
        this.previewing = true;
        preview.color = COLORS.white;
        preview.node.setSiblingIndex(board.children.length - 1);
        this.toast(`完整原图预览 ${seconds} 秒`);
        await new Promise<void>((resolve) => setTimeout(resolve, seconds * 1000));
        if (this.previewSprite === preview) this.previewing = false;
        if (!preview.isValid) return;
        preview.color = new Color(255, 255, 255, 38);
        preview.node.setSiblingIndex(0);
    }

    private resetUnsolved (): void {
        const unsolved = this.runtimePieces.filter((item) => !item.solved);
        const [cols, rows] = this.gridFor(this.currentDifficulty);
        const pieceW = this.boardWidth / cols;
        const pieceH = this.boardHeight / rows;
        const trayScale = Math.min(1, 88 / Math.max(pieceW, pieceH));
        const ordered = this.seededShuffle(unsolved, this.hash(`${this.currentPuzzle?.id}-${this.currentDifficulty}-tray-reset`));
        ordered.forEach((piece, index) => {
            piece.node.setPosition(this.trayPosition(index, this.boardWidth, this.boardHeight));
            piece.node.setScale(trayScale, trayScale, 1);
        });
        this.saveProgress();
        this.toast('未完成拼片已放回右侧托盘');
    }

    private async completePuzzle (): Promise<void> {
        this.completedElapsed = this.elapsedSeconds();
        this.finished = true;
        this.unschedule(this.refreshStatus);
        this.previewSprite!.color = COLORS.white;
        this.previewSprite!.node.setSiblingIndex(this.board!.children.length - 1);
        sys.localStorage.removeItem(SAVE_KEY);
        const completeCount = Number(sys.localStorage.getItem(COMPLETE_KEY) ?? 0) + 1;
        sys.localStorage.setItem(COMPLETE_KEY, String(completeCount));
        if (this.currentPuzzle) {
            this.userState.completed[this.currentPuzzle.id] = (this.userState.completed[this.currentPuzzle.id] ?? 0) + 1;
        }
        if (this.isDaily && !this.userState.dailyStamps.includes(this.beijingDate())) {
            this.userState.dailyStamps.push(this.beijingDate());
        }
        this.writeJson(USER_KEY, this.userState);
        PlatformAdapter.instance.track('puzzle_complete', {
            puzzleId: this.currentPuzzle?.id,
            difficulty: this.currentDifficulty,
            seconds: this.elapsedSeconds(),
        });
        await PlatformAdapter.instance.showInterstitialIfAllowed(completeCount);
        this.showSettlement();
    }

    private showSettlement (): void {
        const layer = this.makeOverlay();
        const modal = this.makePanel(layer, 620, 560, new Vec3(0, -20), COLORS.white, 26);
        this.makeLabel(modal, '拼图完成', 40, COLORS.ink, new Vec3(0, 205), 500, 'center', true);
        this.makeLabel(modal, this.currentPuzzle?.title ?? '', 24, this.currentPuzzle?.accent ?? COLORS.blue, new Vec3(0, 150), 500, 'center', true);
        this.makeLabel(modal, `${this.currentDifficulty} 片  ·  ${this.formatTime(this.elapsedSeconds())}`, 20, COLORS.muted, new Vec3(0, 105), 500, 'center');
        this.makeLabel(modal, '基础奖励已领取', 17, COLORS.jade, new Vec3(0, 62), 500, 'center', true);
        const current = this.currentPuzzle!;
        const favorite = this.userState.favorites.includes(current.id);
        this.makeButton(modal, favorite ? '★ 已收藏' : '☆ 收藏作品', new Vec3(-145, -18), 250, 60, COLORS.gold, () => {
            this.toggleFavorite(current.id);
            this.showSettlement();
        });
        this.makeButton(modal, '分享作品', new Vec3(145, -18), 250, 60, COLORS.blue, () => {
            PlatformAdapter.instance.share(`我完成了《${this.currentPuzzle?.title}》${this.currentDifficulty}片拼图`);
            this.toast('预览环境已记录分享动作');
        });
        this.makeButton(modal, '再玩一次', new Vec3(-145, -98), 250, 58, COLORS.jade, () => {
            const puzzle = this.currentPuzzle!;
            const difficulty = this.currentDifficulty;
            this.startPuzzle(puzzle, difficulty);
        });
        this.makeButton(modal, '下一幅', new Vec3(145, -98), 250, 58, COLORS.vermilion, () => {
            const next = this.puzzles[(this.puzzles.indexOf(current) + 1) % this.puzzles.length];
            this.startPuzzle(next, this.currentDifficulty);
        });
        this.makeButton(modal, '返回图库', new Vec3(0, -168), 540, 50, COLORS.ink, () => this.showHome());
        this.makeAdPlaceholder(modal, new Vec3(0, -235));
        void PlatformAdapter.instance.showBanner('settlement');
    }

    private toggleFavorite (puzzleId: PuzzleId): void {
        const index = this.userState.favorites.indexOf(puzzleId);
        if (index >= 0) this.userState.favorites.splice(index, 1);
        else this.userState.favorites.push(puzzleId);
        this.writeJson(USER_KEY, this.userState);
        PlatformAdapter.instance.track('favorite_change', { puzzleId, favorite: index < 0 });
    }

    private dailyPuzzle (): PuzzleDefinition {
        const index = this.hash(this.beijingDate()) % this.puzzles.length;
        return this.puzzles[index];
    }

    private beijingDate (): string {
        return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
    }

    private isTodayStamped (): boolean {
        return this.userState.dailyStamps.includes(this.beijingDate());
    }

    private readPreviewUsage (): PreviewUsage {
        const date = this.beijingDate();
        const stored = this.readJson<PreviewUsage>(PREVIEW_KEY, { date, freeUsed: 0 });
        return stored.date === date ? stored : { date, freeUsed: 0 };
    }

    private handleAppHide (): void {
        this.saveProgress();
        PlatformAdapter.instance.track('app_hide', {
            puzzleId: this.currentPuzzle?.id,
            progressPct: this.progressPercent(),
        });
    }

    private autoSave = (): void => {
        this.saveProgress();
    };

    private progressPercent (): number {
        if (!this.runtimePieces.length) return 0;
        return Math.round(this.runtimePieces.filter((piece) => piece.solved).length / this.runtimePieces.length * 100);
    }

    private saveProgress (): void {
        if (!this.currentPuzzle || !this.runtimePieces.length || this.finished) return;
        const data: SaveData = {
            version: 2,
            puzzleId: this.currentPuzzle.id,
            difficulty: this.currentDifficulty,
            startedAt: this.startedAt,
            elapsedSeconds: this.elapsedSeconds(),
            freeHints: this.freeHints,
            hintAdsUsed: this.hintAdsUsed,
            previewAdUsed: this.previewAdUsed,
            isDaily: this.isDaily,
            pieces: this.runtimePieces.map((piece) => ({
                index: piece.index,
                x: piece.node.position.x,
                y: piece.node.position.y,
                solved: piece.solved,
            })),
        };
        sys.localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    }

    private readSave (): SaveData | undefined {
        try {
            const raw = sys.localStorage.getItem(SAVE_KEY);
            if (!raw) return undefined;
            const data = JSON.parse(raw) as SaveData;
            return data.version === 1 || data.version === 2 ? data : undefined;
        } catch {
            return undefined;
        }
    }

    private readJson<T> (key: string, fallback: T): T {
        try {
            const raw = sys.localStorage.getItem(key);
            return raw ? { ...fallback, ...JSON.parse(raw) as T } : fallback;
        } catch {
            return fallback;
        }
    }

    private writeJson (key: string, value: unknown): void {
        try {
            sys.localStorage.setItem(key, JSON.stringify(value));
        } catch {
            PlatformAdapter.instance.track('storage_error', { key });
        }
    }

    private refreshStatus = (): void => {
        if (!this.statusLabel || !this.runtimePieces.length) return;
        const solved = this.runtimePieces.filter((item) => item.solved).length;
        this.statusLabel.string = `${solved}/${this.runtimePieces.length} · ${this.formatTime(this.elapsedSeconds())}`;
    };

    private elapsedSeconds (): number {
        if (this.finished) return this.completedElapsed;
        return this.elapsedBeforeStart + Math.max(0, Math.floor((Date.now() - this.startedAt) / 1000));
    }

    private gridFor (difficulty: number): [number, number] {
        if (difficulty === 12) return [4, 3];
        if (difficulty === 24) return [6, 4];
        if (difficulty === 48) return [8, 6];
        return [10, 8];
    }

    private platformName (): string {
        return PlatformAdapter.instance.platform === 'wechat' ? '微信小游戏' : PlatformAdapter.instance.platform === 'douyin' ? '抖音小游戏' : '网页预览';
    }

    private makeNode (name: string, parent: Node, width: number, height: number, position: Vec3): Node {
        const node = new Node(name);
        parent.addChild(node);
        node.setPosition(position);
        const transform = node.addComponent(UITransform);
        transform.setContentSize(width, height);
        return node;
    }

    private drawRect (parent: Node, width: number, height: number, color: Color, radius = 0): Graphics {
        const graphics = parent.getComponent(Graphics) ?? parent.addComponent(Graphics);
        graphics.clear();
        graphics.fillColor = color;
        if (radius > 0) graphics.roundRect(-width / 2, -height / 2, width, height, radius);
        else graphics.rect(-width / 2, -height / 2, width, height);
        graphics.fill();
        return graphics;
    }

    private jigsawEdges (col: number, row: number, cols: number, rows: number): JigsawEdges {
        const edge = (key: string): JigsawEdge => (this.hash(`${this.currentPuzzle?.id}-${this.currentDifficulty}-${key}`) & 1) === 0 ? -1 : 1;
        const top = row === 0 ? 0 : -edge(`horizontal-${row - 1}-${col}`);
        const right = col === cols - 1 ? 0 : edge(`vertical-${row}-${col}`);
        const bottom = row === rows - 1 ? 0 : edge(`horizontal-${row}-${col}`);
        const left = col === 0 ? 0 : -edge(`vertical-${row}-${col - 1}`);
        return { top, right, bottom, left };
    }

    private drawJigsawShape (
        graphics: Graphics,
        width: number,
        height: number,
        tabDepth: number,
        edges: JigsawEdges,
        fill: boolean,
    ): void {
        graphics.clear();
        graphics.moveTo(-width / 2, height / 2);
        this.drawJigsawEdge(graphics, -width / 2, height / 2, width / 2, height / 2, edges.top, tabDepth);
        this.drawJigsawEdge(graphics, width / 2, height / 2, width / 2, -height / 2, edges.right, tabDepth);
        this.drawJigsawEdge(graphics, width / 2, -height / 2, -width / 2, -height / 2, edges.bottom, tabDepth);
        this.drawJigsawEdge(graphics, -width / 2, -height / 2, -width / 2, height / 2, edges.left, tabDepth);
        graphics.close();
        if (fill) {
            graphics.fillColor = COLORS.white;
            graphics.fill();
        } else {
            graphics.stroke();
        }
    }

    private drawJigsawEdge (
        graphics: Graphics,
        startX: number,
        startY: number,
        endX: number,
        endY: number,
        edge: JigsawEdge,
        tabDepth: number,
    ): void {
        if (edge === 0) {
            graphics.lineTo(endX, endY);
            return;
        }
        const dx = endX - startX;
        const dy = endY - startY;
        const length = Math.hypot(dx, dy);
        const normalX = (-dy / length) * tabDepth * edge;
        const normalY = (dx / length) * tabDepth * edge;
        const point = (t: number, normal = 0): [number, number] => [
            startX + dx * t + normalX * normal,
            startY + dy * t + normalY * normal,
        ];
        const p32 = point(0.32);
        const p36 = point(0.36);
        const p40 = point(0.40, 0.42);
        const p42 = point(0.42, 0.95);
        const p58 = point(0.58, 0.95);
        const p60 = point(0.60, 0.42);
        const p64 = point(0.64);
        const p68 = point(0.68);
        graphics.lineTo(p32[0], p32[1]);
        graphics.bezierCurveTo(p36[0], p36[1], p36[0] + normalX * 0.2, p36[1] + normalY * 0.2, p40[0], p40[1]);
        graphics.bezierCurveTo(p42[0], p42[1], p58[0], p58[1], p60[0], p60[1]);
        graphics.bezierCurveTo(p64[0] + normalX * 0.2, p64[1] + normalY * 0.2, p64[0], p64[1], p68[0], p68[1]);
        graphics.lineTo(endX, endY);
    }

    private makePanel (parent: Node, width: number, height: number, position: Vec3, color: Color, radius = 0): Node {
        const panel = this.makeNode('Panel', parent, width, height, position);
        this.drawRect(panel, width, height, color, radius);
        return panel;
    }

    private makeLabel (
        parent: Node,
        text: string,
        fontSize: number,
        color: Color,
        position: Vec3,
        width: number,
        align: 'left' | 'center' | 'right' = 'center',
        bold = false,
    ): Label {
        const node = this.makeNode('Label', parent, width, fontSize * 2.1, position);
        const label = node.addComponent(Label);
        label.string = text;
        label.fontSize = fontSize;
        label.lineHeight = fontSize * 1.45;
        label.color = color;
        label.isBold = bold;
        label.overflow = Label.Overflow.SHRINK;
        label.horizontalAlign = align === 'left' ? Label.HorizontalAlign.LEFT : align === 'right' ? Label.HorizontalAlign.RIGHT : Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        return label;
    }

    private makeButton (parent: Node, text: string, position: Vec3, width: number, height: number, color: Color, action: () => void): Node {
        const button = this.makePanel(parent, width, height, position, color, Math.min(16, height / 2));
        button.addComponent(Button);
        this.makeLabel(button, text, Math.min(20, height * 0.38), COLORS.white, Vec3.ZERO, width - 18, 'center', true);
        button.on(Node.EventType.TOUCH_END, action);
        return button;
    }

    private makePill (parent: Node, text: string, position: Vec3, color: Color): Node {
        const pill = this.makePanel(parent, 220, 42, position, new Color(color.r, color.g, color.b, 35), 21);
        this.makeLabel(pill, text, 15, color, Vec3.ZERO, 200, 'center', true);
        return pill;
    }

    private makeAdPlaceholder (parent: Node, position: Vec3): Node {
        const ad = this.makePanel(parent, 620, 58, position, new Color(230, 232, 233), 12);
        this.makeLabel(ad, '广告 · 开发环境占位（拼图操作页不展示）', 14, COLORS.muted, Vec3.ZERO, 560, 'center');
        return ad;
    }

    private makeOverlay (): Node {
        this.closeOverlay();
        const width = this.layoutWidth;
        const height = 600;
        this.overlay = this.makeNode('Overlay', this.appRoot, width, height, Vec3.ZERO);
        this.drawRect(this.overlay, width, height, new Color(12, 18, 57, 205));
        this.overlay.setSiblingIndex(this.appRoot.children.length - 1);
        return this.overlay;
    }

    private closeOverlay (): void {
        if (this.overlay?.isValid) this.overlay.destroy();
        this.overlay = undefined;
    }

    private toast (message: string): void {
        const old = this.appRoot.getChildByName('Toast');
        old?.destroy();
        const toastY = -235 + this.safeBottom;
        const toast = this.makePanel(this.appRoot, 520, 58, new Vec3(0, toastY), new Color(24, 50, 73, 235), 18);
        toast.name = 'Toast';
        this.makeLabel(toast, message, 16, COLORS.white, Vec3.ZERO, 480, 'center', true);
        toast.setSiblingIndex(this.appRoot.children.length - 1);
        this.scheduleOnce(() => toast.isValid && toast.destroy(), 2.2);
    }

    private confirm (title: string, message: string, confirmText: string): Promise<boolean> {
        return new Promise((resolve) => {
            const layer = this.makeOverlay();
            const modal = this.makePanel(layer, 600, 360, new Vec3(0, 0), COLORS.white, 24);
            this.makeLabel(modal, title, 30, COLORS.ink, new Vec3(0, 105), 520, 'center', true);
            const msg = this.makeLabel(modal, message, 18, COLORS.muted, new Vec3(0, 30), 500, 'center');
            msg.overflow = Label.Overflow.RESIZE_HEIGHT;
            this.makeButton(modal, '取消', new Vec3(-140, -105), 240, 56, COLORS.muted, () => {
                this.closeOverlay();
                resolve(false);
            });
            this.makeButton(modal, confirmText, new Vec3(140, -105), 240, 56, COLORS.blue, () => {
                this.closeOverlay();
                resolve(true);
            });
        });
    }

    private seededShuffle<T> (values: T[], seed: number): T[] {
        const result = values.slice();
        let state = seed || 1;
        const random = () => {
            state ^= state << 13;
            state ^= state >>> 17;
            state ^= state << 5;
            return (state >>> 0) / 0xffffffff;
        };
        for (let i = result.length - 1; i > 0; i--) {
            const j = Math.floor(random() * (i + 1));
            [result[i], result[j]] = [result[j], result[i]];
        }
        return result;
    }

    private hash (value: string): number {
        let hash = 2166136261;
        for (let i = 0; i < value.length; i++) {
            hash ^= value.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return hash >>> 0;
    }

    private formatTime (seconds: number): string {
        const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
        const remain = Math.floor(seconds % 60).toString().padStart(2, '0');
        return `${minutes}:${remain}`;
    }
}
