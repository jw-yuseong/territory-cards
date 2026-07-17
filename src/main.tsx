import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

// 저장해둔 글자 크기 모드 적용
if (localStorage.getItem("fontMode") === "big") {
  document.documentElement.classList.add("big");
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
