# 🏝️ CTISLAND — Thế Giới 2D Nhỏ Xinh Dành Riêng Cho Hai Người

**CTISLAND** là một web game 2D nhẹ nhàng chạy trực tiếp trên trình duyệt (tối ưu cho **GitHub Pages** và gói miễn phí **Firebase Spark Plan**), nơi hai người yêu nhau cùng sở hữu một hòn đảo chung, di chuyển nhân vật, làm nhiệm vụ hằng ngày, trang trí tổ ấm và chăm sóc thú cưng.

---

## 📌 Các Hệ Thống Đã Hoàn Thiện (Giai Đoạn 1 → 3 — PC & Điện Thoại)

- ✅ **Đăng nhập vào thẳng đảo chung (`ctisland_main`):** Không cần tạo phòng hay mã mời — 1 người chơi tự do, bạn gái đăng nhập tự vào chung đảo, khóa cứng tối đa 2 tài khoản bằng `firestore.rules`.
- ✅ **5 Bản đồ 2D riêng biệt (Chuyển cảnh không tải lại trang):**
  1. **🏝️ Đảo Chính (`island`):** Trung tâm kết nối các khu vực, **💌 Cây Kỷ Niệm** ước nguyện & **📋 Bảng Nhiệm Vụ Hằng Ngày (UTC+7)**.
  2. **🏪 Cửa Hàng (`shop`):** Đầy đủ 4 nhóm: **Hạt giống nông trại**, **Nội thất & Cây cảnh**, **Giấy dán tường & Sàn nhà**, **Trang phục đôi & Phụ kiện thú cưng** lưu vào Túi đồ chung `inventory/ctisland_main`.
  3. **🌻 Khu Vườn (`garden`):** Mở sẵn **6 ô đất**, mở khóa bằng Điểm yêu thương tối đa **54 ô đất (lưới 9×6)**; gieo hạt, tưới nước tăng tốc 25% và thu hoạch nhận Điểm yêu thương.
  4. **🐾 Khu Thú Cưng (`pet`):** Sân chơi riêng nuôi tối đa **10 bé thú cưng** (Mèo, Chó, Thỏ — bé đầu tiên miễn phí `0 ❤️`), đeo phụ kiện nơ/chuông/hoa/vương miện trực tiếp lên thú cưng và tính chỉ số `Hunger / Happiness / Energy` theo thời gian thực.
  5. **🏡 Khu Nhà Chung (`house`):** Đổi tường, đổi sàn, đặt & kéo thả sắp xếp nội thất trực tiếp trên sàn, và **Nâng cấp nhà từ Cấp 1 lên Cấp 4** mở rộng diện tích phòng thật sự (`8 -> 16 -> 26 -> 40` món).
- ✅ **Tủ Đồ Đôi, Bong Bóng Chat, Biểu Cảm & Sổ Lưu Bút Kỷ Niệm (Giai đoạn 3):**
  - **👗 Tủ Đồ Nhân Vật:** Mở khóa 1 lần mặc chung cho cả hai (Áo đôi & Nón/cài tóc hiển thị trực tiếp trên bản đồ 2D).
  - **💬 Tương tác Đôi Lứa Realtime:** Gõ bong bóng chat hiện thẳng lên đầu nhân vật & thả biểu cảm (`💖`, `🤗`, `😘`, `🌸`, `🎉`), kèm thông báo ngọt ngào khi người thương nhắn từ khu vực khác.
  - **💌 Cây Kỷ Niệm & Đếm Ngày Yêu (`memories`):** Đếm số ngày bên nhau (`💑 Bên nhau X ngày`) và viết/xem lưu bút kỷ niệm theo 4 tâm trạng.
  - **📋 7 Nhiệm Vụ Hằng Ngày (UTC+7), Chuỗi Ngày Lên Đảo (`🔥 Chuỗi X ngày`) & Bộ Lọc Lịch Sử Điểm.**

---

## 🛠️ Hướng Dẫn Tạo Firebase & Kết Nối (Gói Miễn Phí Spark Plan)

### Bước 1: Tạo Project trên Firebase Console
1. Truy cập [https://console.firebase.google.com/](https://console.firebase.google.com/) và đăng nhập tài khoản Google.
2. Bấm **Create a project** (hoặc **Add project**), đặt tên ví dụ `ctisland-love`.
3. Bạn có thể tắt Google Analytics để tạo nhanh hơn -> bấm **Create project** (mặc định là gói miễn phí **Spark Plan**, không cần thẻ thanh toán).

### Bước 2: Bật Firebase Authentication (Email/Password)
1. Ở menu bên trái, vào **Build** -> **Authentication** -> bấm **Get started**.
2. Trong tab **Sign-in method**, chọn **Email/Password**.
3. Bật công tắc **Enable** ở dòng *Email/Password* (không cần bật *Email link*) -> bấm **Save**.

### Bước 3: Tạo Cloud Firestore Database & Dán Security Rules
1. Ở menu bên trái, vào **Build** -> **Firestore Database** -> bấm **Create database**.
2. Chọn cụm máy chủ gần Việt Nam như `asia-southeast1 (Singapore)` -> bấm **Next**.
3. Chọn **Start in production mode** -> bấm **Create**.
4. Sau khi Database khởi tạo xong, chuyển sang tab **Rules** ở phía trên cùng.
5. Xóa nội dung mặc định, copy **toàn bộ nội dung trong file `firestore.rules`** của dự án này dán vào ô soạn thảo -> bấm **Publish**.

### Bước 4: Lấy `firebaseConfig` điền vào code
1. Bấm biểu tượng **Bánh răng ⚙️ (Project Overview -> Project settings)** ở góc trên trái.
2. Cuộn xuống mục **Your apps**, bấm biểu tượng Web **`</>`**.
3. Đặt nickname (VD: `CTISLAND Web`), **không** cần tích Firebase Hosting -> bấm **Register app**.
4. Copy các giá trị trong `const firebaseConfig = { ... }` và mở file `js/firebase.js`, thay thế vào phần mẫu:
   ```js
   export const firebaseConfig = {
     apiKey: "AIzaSy...",
     authDomain: "ten-project.firebaseapp.com",
     projectId: "ten-project",
     storageBucket: "ten-project.appspot.com",
     messagingSenderId: "123456789...",
     appId: "1:123456789:web:abcdef..."
   };
   ```

---

## 🚀 Cách Chạy Thử Trên Máy & Kiểm Thử Giai Đoạn 1

> **Lưu ý:** Vì dự án sử dụng JavaScript **ES Modules** chuẩn (`<script type="module">`), trình duyệt yêu cầu mở qua `http://` hoặc `https://` (không mở trực tiếp bằng cách nháy đúp `file://`).

### Cách chạy nhanh trên máy tính:
- **Cách 1 (Khuyên dùng trên VS Code):** Cài extension **Live Server**, nhấp chuột phải vào `CTISLAND/index.html` -> chọn **Open with Live Server**.
- **Cách 2 (Dùng Python có sẵn):** Mở terminal tại thư mục `CTISLAND` và chạy:
  ```bash
  python -m http.server 5500
  ```
  Sau đó mở trình duyệt tại `http://localhost:5500`.

### Kịch bản kiểm thử đồng bộ 2 tài khoản (Giai đoạn 1):
1. **Cửa sổ 1 (Trình duyệt thường - Người thứ nhất):**
   - Vào `register.html`, tạo Tài khoản A và chọn nhân vật *Mầm Xanh*.
   - Hệ thống tự chuyển sang `game.html`. Tạo thế giới mới (VD: *"Đảo Mùa Xuân"*) -> nhận **Mã mời 8 ký tự** (VD: `K7M4P9X2`).
2. **Cửa sổ 2 (Cửa sổ Ẩn danh / Incognito hoặc Điện thoại - Người thứ hai):**
   - Vào `register.html`, tạo Tài khoản B và chọn nhân vật *Đào Hồng*.
   - Tại sảnh ghép đôi, nhập mã `K7M4P9X2` -> kiểm tra hộp thoại xác nhận hiện đúng tên *"Đảo Mùa Xuân"* và tên Tài khoản A -> bấm **Cùng vào đảo**.
3. **Kiểm tra đồng bộ tức thì (`onSnapshot`):**
   - Đặt 2 cửa sổ cạnh nhau: Ngay khoảnh khắc Tài khoản B bấm tham gia, màn hình Tài khoản A **tự động nhảy sang 2/2 thành viên**, ẩn khung chờ mã mời và hiển thị nhân vật của cả hai đứng cạnh nhau mà **không cần F5 tải lại trang**.
   - Từ một trong hai cửa sổ, bấm **✏️ Đổi tên** đảo -> cửa sổ còn lại tự động đổi tên theo ngay lập tức.
4. **Kiểm tra bảo mật chặn người thứ 3:**
   - Mở thêm trình duyệt thứ 3, đăng ký Tài khoản C và thử nhập lại mã `K7M4P9X2` -> bị chặn hoàn toàn bởi Firestore Security Rules!

---

## 🔐 Giải Thích Minh Bạch Về Bảo Mật (Không Dùng Backend Riêng)

Do CTISLAND vận hành hoàn toàn trên trình duyệt kết hợp **Firebase Spark Plan** (không sử dụng Node.js server riêng hay Cloud Functions trả phí):

- **Những gì `firestore.rules` ĐÃ bảo vệ chặt chẽ ở phía máy chủ Google:**
  - Người chưa đăng nhập không thể đọc/ghi bất kỳ dữ liệu nào.
  - Không ai có thể liệt kê (`list`) danh sách tài khoản hoặc danh sách các thế giới.
  - Mỗi tài khoản chỉ được tạo hoặc tham gia duy nhất 1 thế giới (kiểm tra chéo nguyên tử bằng `get()` và `getAfter()`).
  - Mỗi thế giới bị khóa cứng tối đa **2 thành viên** — khi đã đủ 2 người, người thứ 3 không thể đọc hay ghi kể cả khi biết mã mời hoặc can thiệp từ DevTools Console.
  - Người chơi **không thể** mở DevTools Console để tự ý sửa số `lovePoints`, đổi `createdBy`, hay xóa thành viên còn lại.
- **Giới hạn bảo mật cần lưu ý khi không có Backend:**
  - Ở các giai đoạn tiếp theo (Nhiệm vụ, Chăm sóc thú cưng), các hành động gameplay như "bấm tưới cây" hay "cho thú ăn" được gửi trực tiếp từ trình duyệt của 2 thành viên. Security Rules sẽ chặn việc *nhận thưởng trùng 1 nhiệm vụ*, *cộng sai số điểm quy định*, hoặc *mua đồ khi không đủ điểm*, nhưng không thể xác minh vật lý xem người chơi có dùng script tự động bấm hoàn thành nhiệm vụ hằng ngày trên trình duyệt của chính họ hay không. Đối với một tựa game ấm áp dành riêng cho hai người yêu nhau cùng xây dựng, mô hình này đạt sự cân bằng tối ưu giữa **an toàn dữ liệu riêng tư**, **tốc độ đồng bộ** và **100% miễn phí duy trì lâu dài**.

# ctisland
