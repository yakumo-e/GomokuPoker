# Gomoku Poker

五目並べとポーカーを混ぜた、黒対赤のオンライン対戦ゲームです。

## ルール

- 黒と赤はそれぞれ、スートなしの A から K を2枚ずつ持ちます（各26枚）。
- 自分の番でカードを1枚置き、宣言するか相手にターンを渡します。
- 5マスのラインに自分のカードが4枚以上、相手が1枚までなら宣言できます。
- 宣言された側は次のターンでカードを1枚置いてから必ず応戦宣言します。
- 両者の宣言した役を比べて勝敗を決めます。

## 役

ファイブカード、フォーカード、フルハウス、ストレート、スリーカード、ツーペア、ワンペア。

## セキュリティの注意

このバージョンはサーバ判定なし（クライアントがFirestoreを直接更新）です。Firestoreルールで「他人へのなりすまし」「部屋乗っ取り」は防いでいますが、**自分の手のチート（ブラウザ開発者ツールでstateを書き換えるなど）は技術的に可能**です。身内で遊ぶ用途を想定しています。

## ブラウザだけでセットアップ（無料プラン Spark で完結）

### 1. Firebase プロジェクト作成

1. https://console.firebase.google.com/ で新規プロジェクト作成（Sparkのまま）
2. **Authentication → Sign-in method → 匿名** を有効化
3. **Firestore Database** を本番モードで作成、リージョン `asia-northeast1`
4. **App Check** を開いて、reCAPTCHA v3 を登録 → サイトキーを控える
5. **プロジェクトの設定 → 全般 → Web アプリ** を登録 → `firebaseConfig` の値をコピー

### 2. Firestore ルールを Console で適用

`firestore.rules` の内容を Firebase Console の **Firestore Database → ルール** に貼って **公開**。

### 3. コードを GitHub にアップ

1. GitHub で新規リポジトリを作成
2. ブラウザの Upload files で全ファイルをドラッグ＆ドロップ
3. `firebase-config.js` を GitHub 上で編集して以下を入れる:
   - `firebaseConfig` の値
   - `appCheckSiteKey` に reCAPTCHA v3 サイトキー

### 4. GitHub Pages で公開

リポジトリ **Settings → Pages → Source: main / (root)** → Save。

数十秒後に `https://<ユーザー名>.github.io/<リポジトリ名>/` で公開されます。

### 5. App Check 強制と APIキー保護

- Firebase Console → **App Check** で Firestore を「強制」に切り替え（ボット遮断）
- GCP Console → 認証情報 → ブラウザキーに **HTTPリファラ制限**:
  - `https://<ユーザー名>.github.io/*`

## ローカル開発

```bash
npm run dev
```

`http://127.0.0.1:5173` でローカル対戦のみ試せます。
