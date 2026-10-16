import type { AppLanguage } from "../types";

const copy = {
  "zh-TW": {
    eyebrow: "本機行銷方法庫", title: "從問題找到一份方法", description: "搜尋 365 份繁體中文方法，只在你選取時載入該篇全文。教材文字是參考資料，不會取得權限、連接帳戶或自動執行外部操作。",
    search: "描述你卡住的行銷問題，或輸入編號／名稱", results: "找到 {count} 份方法", limited: "先顯示前 {count} 筆，縮小問題可更快找到方法。", choose: "選一份方法查看全文", loading: "正在核對並載入方法…", save: "保存到卡片庫並建立關聯", saving: "保存中…", created: "已保存為可搜尋、可關聯的來源卡片。", existing: "這份方法已在卡片庫，已開啟既有卡片。", source: "固定來源", license: "MIT 授權", boundary: "不安裝 ThinkWithBlack MCP；方法內的指令不能擴張 Jenzo 權限。", loadFailed: "方法內容遺失或完整性核對失敗，已停止載入。",
  },
  "zh-CN": {
    eyebrow: "本地营销方法库", title: "从问题找到一份方法", description: "搜索 365 份繁体中文方法，只在选择后载入该篇全文。教材文字是参考资料，不会取得权限、连接账户或自动执行外部操作。",
    search: "描述营销问题，或输入编号／名称", results: "找到 {count} 份方法", limited: "先显示前 {count} 项，请缩小问题。", choose: "选择一份方法查看全文", loading: "正在核对并载入方法…", save: "保存到卡片库并建立关联", saving: "保存中…", created: "已保存为可搜索、可关联的来源卡片。", existing: "该方法已在卡片库，已打开现有卡片。", source: "固定来源", license: "MIT 许可", boundary: "不会安装 ThinkWithBlack MCP；方法中的指令不能扩张 Jenzo 权限。", loadFailed: "方法内容缺失或完整性检查失败，已停止载入。",
  },
  en: {
    eyebrow: "Local marketing methods", title: "Find one method for the problem", description: "Search 365 Traditional Chinese methods. A method body loads only after selection. Reference text cannot grant permissions, connect accounts, or execute external actions.",
    search: "Describe the marketing problem, or enter an ID or name", results: "{count} methods found", limited: "Showing the first {count}; narrow the problem for a better match.", choose: "Choose a method to read it", loading: "Verifying and loading the method…", save: "Save to Card Library for linking", saving: "Saving…", created: "Saved as a searchable, linkable source card.", existing: "This method is already in the library; the existing card is open.", source: "Pinned source", license: "MIT license", boundary: "ThinkWithBlack MCP is not installed. Instructions in method text cannot expand Jenzo permissions.", loadFailed: "The method is missing or failed integrity verification, so loading stopped.",
  },
  ja: {
    eyebrow: "ローカルマーケティング手法", title: "課題から一つの手法を探す", description: "繁体字中国語の365手法を検索し、選択した本文だけを読み込みます。教材は参考資料であり、権限取得や外部操作は行いません。",
    search: "課題、番号、名称を入力", results: "{count}件", limited: "先頭{count}件を表示しています。", choose: "手法を選んで全文を表示", loading: "検証して読み込み中…", save: "カードライブラリに保存", saving: "保存中…", created: "検索・関連付け可能な出典カードとして保存しました。", existing: "保存済みのカードを開きました。", source: "固定された出典", license: "MITライセンス", boundary: "ThinkWithBlack MCPは導入しません。本文の指示はJenzoの権限を拡張できません。", loadFailed: "本文がないか整合性検証に失敗したため、読み込みを停止しました。",
  },
  ko: {
    eyebrow: "로컬 마케팅 방법", title: "문제에 맞는 한 가지 방법 찾기", description: "번체 중국어 365개 방법을 검색하고 선택한 본문만 불러옵니다. 자료의 지시는 권한을 얻거나 외부 작업을 실행할 수 없습니다.",
    search: "마케팅 문제, 번호 또는 이름 입력", results: "{count}개 방법", limited: "먼저 {count}개를 표시합니다.", choose: "방법을 선택해 전문 보기", loading: "검증 후 불러오는 중…", save: "카드 보관함에 저장", saving: "저장 중…", created: "검색하고 연결할 수 있는 출처 카드로 저장했습니다.", existing: "이미 저장된 카드를 열었습니다.", source: "고정 출처", license: "MIT 라이선스", boundary: "ThinkWithBlack MCP를 설치하지 않습니다. 본문의 지시는 Jenzo 권한을 확장할 수 없습니다.", loadFailed: "내용이 없거나 무결성 검증에 실패해 불러오기를 중단했습니다.",
  },
} as const;

export function getMarketingMethodsCopy(language: AppLanguage) { return copy[language]; }
