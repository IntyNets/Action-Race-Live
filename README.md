# Đấu Trường Đua Tốc Độ 3D — Action Race Live

Game đua tốc độ 3D tương tác trực tiếp **Đa Nền Tảng (TikTok LIVE & Facebook Live)**, sử dụng nhân vật & thú cưng 3D từ **iErcann/NotBlox**, hệ thống **Smart Broadcast Camera Director** + **Drone Toàn Cảnh (PiP)** và **Lưu Trữ Hồ Sơ Người Chơi Bền Vững** (`data/users.json`), tối ưu khung hình dọc **9:16 (1080×1920)** cho OBS / PRISM Live Studio / TikTok LIVE Studio.

## Tính năng chính
- **Kết nối Live Đa Nền Tảng (chạy độc lập hoặc song song cả TikTok + Facebook)**:
  - **🎵 TikTok LIVE**: Kết nối trực tiếp qua username, hỗ trợ cộng dồn quà combo, nhận diện Chat, Tim, Quà, Member, Follow, Share.
  - **🔵 Facebook Live**: Hỗ trợ cả **Cầu nối Trình duyệt & Tiện ích Chạy Ngầm (Không cần Token, Không cần F12)** lẫn **Facebook Graph API**. Tự động chuyển đổi tặng **⭐ Sao Facebook** thành quà tăng tốc VIP.
- **Lưu trữ Hồ sơ Người chơi Bền vững (`data/users.json`)**:
  - Tự động lưu **Cấp độ (`Lv.1+`)**, **Điểm kinh nghiệm (`XP`)**, **Số trận thắng**, **Đặc điểm nhân vật NotBlox (`Character` / `MiniCharacter` + màu trang phục)** và **Thú cưng VIP (`petName`, `petSpeedBonus`)**.
  - Khi người chơi cũ bình luận vào lại ở các ván sau, hệ thống tự động nạp lại toàn bộ cấp độ, trang phục và thú cưng đồng hành.
- **4 Bản Đồ Đường Đua 3D & Cảnh Vật Riêng Biệt**:
  - 🏞️ **Grand Prix Công Viên** (`0.81 km/vòng`)
  - 🏟️ **Sân Vận Động Oval** (`0.84 km/vòng`)
  - ⛰️ **Đèo Uốn Lượn** (`1.13 km/vòng`)
  - 🌃 **Đô Thị Neon Đêm** (`1.04 km/vòng`)
- **Smart Broadcast Camera & Camera Drone Toàn Cảnh (Góc phải dưới)**:
  - Máy quay truyền hình tự động bám đoàn đua mượt mà qua mọi khúc cua, tự động chuyển cảnh Spotlight khi có người tặng quà / vượt Top 1, kèm hiệu ứng tia sét Speed-Force kiểu *The Flash*.
  - Khung **🚁 Drone Toàn Cảnh (PiP)** ở góc phải dưới hiển thị vị trí toàn bộ người chơi trên sân theo thời gian thực.

## Vào đua, đồ họa và MC

- **TikTok**: Follow trong phiên live để vào đua ngay. Người đã Follow gửi bình luận bất kỳ khi TikTok trả trạng thái Follow hoặc game đã ghi nhận trước đó. **Facebook Live** nhận người chơi qua bình luận vì nguồn bình luận hiện tại không có trạng thái Follow.
- **Thấp** đặt mục tiêu 30 fps, giảm độ phân giải nội bộ, số tay đua hiển thị và tắt bóng/drone. **4K UHD** dựng canvas đến 2160 × 3840 ở Stage dọc nếu GPU hỗ trợ. Phần mềm hoặc bộ phát cũng cần cấu hình đầu ra 4K để khán giả nhận được độ phân giải đó.
- Trong **Hồ sơ người chơi**, tìm tay đua và chọn **Đặt lại cấp độ** để đưa về cấp 1, 0 XP. Thắng, số trận, trang phục và thú cưng được giữ.

### MC AI và giọng riêng

Thiết lập các biến sau trong `.env` của bản Docker độc lập, rồi tạo lại dịch vụ. Với phòng CPanel, khai báo các biến trong môi trường của container game.

```dotenv
RACE_HOST_TOKEN=<khóa-ngẫu-nhiên-tối-thiểu-16-ký-tự>
GROQ_API_KEY=<khóa-Groq>
ELEVENLABS_API_KEY=<khóa-ElevenLabs>
```

Trong **MC AI và giọng nói**, nhập khóa điều khiển MC và bật AI để phản hồi một số bình luận TikTok/Facebook bằng tiếng Việt. Giọng Nam Minh và Hoài My dùng được với TTS tích hợp. Với giọng riêng, nhập Voice ID trong tài khoản ElevenLabs hoặc chọn bản ghi hợp lệ dưới 10 MB rồi bấm **Tạo và dùng giọng này**. Mẫu được gửi tới ElevenLabs, còn game lưu tùy chọn và Voice ID trong `data/host-commentary.json`. Stage dùng giọng đã lưu cho cả MC thường và MC AI.

## Chạy Production trên VPS bằng Docker Compose
```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```
- **Bảng Điều Khiển Streamer (Im lặng)**: `http://localhost:3002/`
- **Màn Hình Chế Độ Live (OBS / 9:16)**: `http://localhost:3002/?view=stage`
