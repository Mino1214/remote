/** 로그인 페이지가 정적으로 빌드되며 CF에 장기 캐시되는 것을 막는다. */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
