# TikTok LIVE 3D Interactive Race (Three.js)

Game đua tốc độ tương tác trực tiếp trên **TikTok LIVE**, đồ họa **3D Blocky / Low-poly** (phong cách Roblox), tối ưu khung hình dọc **9:16 (1080×1920)** cho OBS / TikTok LIVE Studio.

## Tính năng chính
- **Vòng lặp trận đấu tự động**:
  1. **Lobby (15s)**: Người xem bình luận bất kỳ (`1`, `play`, ...) để xuất hiện tại vạch xuất phát.
  2. **Racing (tối đa 60s)**: Tự động chạy 1,000m, tương tác để tăng tốc; người mới vẫn có thể bình luận vào đua giữa chừng.
  3. **Finish & Podium (5s đếm ngược + 10s Bục Vinh Danh 3D)**: Bục Top 3 + Pháo hoa 3D + Avatar & Tên + Tự động reset ván mới.
- **Ánh xạ sự kiện TikTok LIVE (< 0.5s qua WebSocket)**:
  - **Chat**: Tạo nhân vật mới hoặc tăng tốc nhẹ (cooldown 2 giây/người).
  - **Thả tim (Like)**: Tích 3 tim → kích hoạt **Sprint** 2 giây.
  - **Quà nhỏ (1–10 xu)**: **🎒 Jetpack** bay lướt 4 giây.
  - **Quà trung (11–99 xu)**: **🚀 Tên lửa** vượt mặt 6 giây + SFX tên lửa.
  - **Quà lớn (100+ xu)**: **🐉 Hóa Rồng Khổng Lồ VIP** 10 giây + Thông báo toàn màn hình + Giọng MC bình luận.
- **Tối ưu 60 FPS cùng OBS**: Dùng chung Geometry/Material + `InstancedMesh` cho môi trường + giới hạn tối đa 60 nhân vật render đồng thời (ưu tiên Top đầu & người vừa tương tác).
- **Mock Mode ẩn (Phím `H`)**: Bấm `H` để mở bảng kết nối TikTok ID và test giả lập Chat / Tap / Quà nhỏ / Quà trung / Quà VIP mà không cần bật live thật.

## Chạy nhanh bằng Docker
```bash
cd "d:\DEVELOP\ACTION LIVE\tiktok-live-3d-race"
docker compose -f docker-compose.dev.yml up -d --build
```
Sau đó mở trình duyệt tại: **http://localhost:3002** (bấm phím **`H`** để mở Bảng Điều Khiển & Mock Mode).

