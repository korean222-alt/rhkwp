// Replace these values when a new advertiser is booked.
export const TODAY_BANNER = {
  href: 'https://mddcalc.com/',
  image: '/ads/mddcalc-banner.png',
  width: 2172,
  height: 724,
  alt: '주식 MDD 계산기 — 투자 최대 손실폭을 계산하는 mddcalc.com',
  contact: 'ekrb2309@gmail.com',
  rate: '하루 1000원 (변동될 수 있음)',
};

export function AdBanner({ compact = false }: { compact?: boolean }) {
  return <section className={`ad-banner${compact ? ' ad-banner--compact' : ''}`} aria-label="오늘의 배너 광고">
    <div className="ad-banner-heading"><h2>오늘의 배너</h2><span className="ad-label">광고</span></div>
    <a className="ad-banner-link" href={TODAY_BANNER.href} target="_blank" rel="sponsored noopener noreferrer" aria-label="광고: 주식 MDD 계산기 — mddcalc.com (새 탭에서 열림)">
      <img src={new URL(TODAY_BANNER.image, window.location.origin).href} alt={TODAY_BANNER.alt} width={TODAY_BANNER.width} height={TODAY_BANNER.height} loading="lazy" decoding="async" />
    </a>
    <div className="ad-banner-info"><span>문의: <a href={`mailto:${TODAY_BANNER.contact}`}>{TODAY_BANNER.contact}</a></span><span>단가: {TODAY_BANNER.rate}</span></div>
  </section>;
}
