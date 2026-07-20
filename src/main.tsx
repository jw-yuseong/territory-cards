import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

// 저장해둔 글자 크기 단계 적용 (1~5, 기본 2; 예전 '큰글씨' 설정은 4단계로 이어받음)
let fontLevel = Number(localStorage.getItem("fontLevel"));
if (!fontLevel || fontLevel < 1 || fontLevel > 7) {
  fontLevel = localStorage.getItem("fontMode") === "big" ? 4 : 2;
}
document.documentElement.classList.add("font-" + fontLevel);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
