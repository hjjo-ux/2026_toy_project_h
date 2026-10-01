import { Outlet } from "react-router-dom";
import { HistoryProvider } from "../../context/HistoryContext.jsx";
import Header from "./Header.jsx";
import styles from "./AppLayout.module.css";

// Header의 알림 벨이 이 화면에서도 이력/댓글 안읽음 정보를 그대로 보여줘야 해서
// AppLayout과 마찬가지로 HistoryProvider로 감쌉니다 — 안 그러면 useHistoryOptional()이
// null을 돌려줘서, 계정 설정 화면에 들어오는 순간 알림이 전부 사라진 것처럼 보입니다.
export default function HeaderLayout() {
  return (
    <HistoryProvider>
      <div className={styles.shell}>
        <Header hideProjectSwitcher />
        <main className={styles.content} data-scroll-container>
          <Outlet />
        </main>
      </div>
    </HistoryProvider>
  );
}
