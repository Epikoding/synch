export const defaultLocale = "en";
export const locales = ["en", "ko"] as const;

export type Locale = (typeof locales)[number];

export function getLocale(locale?: string): Locale {
	return locales.includes(locale as Locale) ? (locale as Locale) : defaultLocale;
}

export function localizedPath(locale: Locale, path = "/") {
	const normalizedPath = path.startsWith("/") ? path : `/${path}`;

	if (locale === defaultLocale) {
		return normalizedPath;
	}

	if (normalizedPath === "/") {
		return `/${locale}`;
	}

	return `/${locale}${normalizedPath}`;
}

export function blogSlug(id: string, locale: Locale) {
	return id
		.replace(new RegExp(`^${locale}/`), "")
		.replace(new RegExp(`/${locale}$`), "")
		.replace(/\/index$/, "");
}

export function isLocaleEntry(id: string, locale: Locale) {
	return id.startsWith(`${locale}/`) || id.endsWith(`/${locale}`);
}

export const ui = {
	en: {
		meta: {
			defaultTitle: "Synch - Open-source E2EE sync for Obsidian",
			pricingTitle: "Pricing - Synch",
			blogTitle: "Blog - Synch",
			billingSuccessTitle: "Confirming subscription - Synch",
		},
		nav: {
			pricing: "Pricing",
			github: "GitHub",
			signIn: "Sign In",
			joinWaitlist: "Join Waitlist",
			vaults: "Vaults",
			terms: "Terms",
			privacy: "Privacy",
		},
		home: {
			heroTitle: ["End-to-end encrypted sync", "for Obsidian."],
			featuredTitle: "Learn more",
			featuredPosts: [
				{
					title: "How does Synch's end-to-end encryption work?",
					body: "A plain-English walkthrough of how Synch encrypts vault data, protects the vault key, and unlocks encrypted data on another device.",
					href: "/blog/encryption-and-decryption"
				}
			],
			heroBody:
				"An open-source alternative to Obsidian Sync. Your notes are encrypted locally before leaving your device, ensuring complete privacy and control over your data.",
			getStarted: "Get Started",
			viewSource: "View Source",
			features: [
				{
					title: "Zero Knowledge",
					body: "Everything is encrypted with AES-256-GCM on your device. The server never sees your raw notes.",
				},
				{
					title: "Open Source",
					body: "Built in the open. You can inspect the code, host it yourself, or contribute to the project on GitHub.",
				},
			],
			installTitle: "How to Install",
			installIntroBefore: "The Synch plugin is currently in early development and can be installed via the",
			installIntroAfter: "plugin.",
			installSteps: [
				["Open Obsidian Settings and go to", "Community plugins", "."],
				["Turn off Safe mode and click", "Browse", "."],
				["Search for and install", "Obsidian42 - BRAT", ", then enable it."],
				["Open the BRAT settings, and click", "Add Beta plugin", "."],
				["Enter the repository URL:"],
				["Go back to Community plugins and enable", "Synch", "."],
			],
			addRepositorySuffix: "and add it.",
			copyTitle: "Copy to clipboard",
		},
		waitlist: {
			title: "Join the Synch waitlist",
			body: "Synch hosted accounts are opening gradually. Leave your email and we will send an invite when new spots are available.",
			emailLabel: "Email",
			emailPlaceholder: "you@example.com",
			submit: "Join Waitlist",
			submitting: "Joining...",
			success: "You are on the waitlist.",
			duplicate: "You are already on the waitlist.",
			error: "Could not join the waitlist. Please try again.",
			close: "Close",
		},
		pricing: {
			heading: "Simple, transparent pricing.",
			subheading: "Start syncing your vaults for free.",
			freePlan: "Sync Free",
			starterPlan: "Sync Starter",
			forever: "/ forever",
			month: "/ month",
			comingSoon: "Coming Soon",
			features: {
				oneVault: "1 synced vault",
				freeStorage: "50 MB storage",
				starterStorage: "1 GB storage",
				freeFileSize: "3 MB max file size",
				starterFileSize: "5 MB max file size",
				history: "1 day version history",
			},
		},
		blog: {
			heading: "Blog",
			empty: "No blog posts have been added yet.",
			dateLocale: "en",
		},
		billing: {
			heading: "Confirming subscription",
			message: "Your subscription is being applied. This usually takes a few seconds.",
			continue: "Continue to vaults",
			fallback: "Still waiting for payment confirmation. You can continue and refresh later.",
		},
	},
	ko: {
		meta: {
			defaultTitle: "Synch - Obsidian용 오픈소스 종단 간 암호화 동기화",
			pricingTitle: "요금제 - Synch",
			blogTitle: "블로그 - Synch",
			billingSuccessTitle: "구독 확인 중 - Synch",
		},
		nav: {
			pricing: "요금제",
			github: "GitHub",
			signIn: "로그인",
			joinWaitlist: "대기자 등록",
			vaults: "Vaults",
			terms: "이용약관",
			privacy: "개인정보 처리방침",
		},
		home: {
			heroTitle: ["Obsidian을 위한", "종단간 암호화 동기화."],
			featuredTitle: "더 알아보기",
			featuredPosts: [
				{
					title: "Synch의 종단 간 암호화는 어떻게 작동할까요?",
					body: "Synch가 어떻게 데이터를 암호화하고, 키를 보호하며, 다른 기기에서 안전하게 데이터를 여는지 알기 쉽게 설명합니다.",
					href: "/blog/encryption-and-decryption"
				}
			],
			heroBody:
				"Obsidian Sync를 대체할 수 있는 오픈소스 동기화 서비스입니다. 노트는 기기 안에서 먼저 암호화된 뒤 전송되므로, 내 데이터는 내가 안전하게 관리할 수 있습니다.",
			getStarted: "시작하기",
			viewSource: "소스 보기",
			features: [
				{
					title: "서버도 볼 수 없는 암호화",
					body: "모든 데이터는 내 기기에서 AES-256-GCM으로 암호화됩니다. 서버에는 암호화된 내용만 저장되고, 원본 노트는 전달되지 않습니다.",
				},
				{
					title: "오픈소스",
					body: "개발 과정과 코드가 모두 공개되어 있습니다. 코드를 직접 확인하고, 직접 호스팅하거나, GitHub에서 프로젝트에 참여할 수 있습니다.",
				},
			],
			installTitle: "설치 방법",
			installIntroBefore: "Synch 플러그인은 아직 초기 개발 단계라",
			installIntroAfter: "플러그인을 통해 설치할 수 있습니다.",
			installSteps: [
				["Obsidian 설정을 열고", "Community plugins", "로 이동합니다."],
				["Safe mode를 끄고", "Browse", "를 클릭합니다."],
				["", "Obsidian42 - BRAT", "을 검색해 설치한 다음 활성화합니다."],
				["BRAT 설정을 열고", "Add Beta plugin", "을 클릭합니다."],
				["저장소 URL을 입력합니다:"],
				["Community plugins로 돌아가", "Synch", "를 활성화합니다."],
			],
			addRepositorySuffix: "입력한 뒤 추가합니다.",
			copyTitle: "클립보드에 복사",
		},
		waitlist: {
			title: "Synch 대기자 등록",
			body: "Synch 호스팅 계정은 순차적으로 열고 있습니다. 이메일을 남겨주시면 새 자리가 열릴 때 초대를 보내드릴게요.",
			emailLabel: "이메일",
			emailPlaceholder: "you@example.com",
			submit: "대기자 등록",
			submitting: "등록 중...",
			success: "대기자 명단에 등록되었습니다.",
			duplicate: "이미 대기자 명단에 등록되어 있습니다.",
			error: "등록하지 못했습니다. 다시 시도해 주세요.",
			close: "닫기",
		},
		pricing: {
			heading: "간단하고 투명한 요금제.",
			subheading: "무료로 vault 동기화를 시작하세요.",
			freePlan: "Sync Free",
			starterPlan: "Sync Starter",
			forever: "/ 평생 무료",
			month: "/ 월",
			comingSoon: "준비 중",
			features: {
				oneVault: "vault 1개 동기화",
				freeStorage: "저장 공간 50 MB",
				starterStorage: "저장 공간 1 GB",
				freeFileSize: "파일당 최대 3 MB",
				starterFileSize: "파일당 최대 5 MB",
				history: "버전 기록 1일",
			},
		},
		blog: {
			heading: "블로그",
			empty: "아직 블로그 글이 없습니다.",
			dateLocale: "ko-KR",
		},
		billing: {
			heading: "구독 확인 중",
			message: "구독 정보를 적용하고 있습니다. 보통 몇 초 안에 완료됩니다.",
			continue: "Vaults로 이동",
			fallback: "아직 결제 확인이 끝나지 않았습니다. 먼저 이동한 뒤 나중에 새로고침해도 됩니다.",
		},
	},
} as const;
