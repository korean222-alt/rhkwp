import React, { Component, type ReactNode } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <div className="fatal"><h1>화면을 다시 열어 주세요</h1><p>앱 화면을 불러오지 못했습니다. 저장된 강의 자료는 브라우저에 남아 있습니다.</p><button className="button primary" onClick={() => location.reload()}>다시 열기</button></div> : this.props.children;
  }
}
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><ErrorBoundary><App /></ErrorBoundary></React.StrictMode>);
