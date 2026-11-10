# Ảnh menu BrewLite

Bổ sung ảnh raster tạo bằng imagegen cho các món tìm thấy trong seed/tài liệu repository:

| Món | Asset |
|---|---|
| Cappuccino | frontend/public/images/cappuccino.jpg |
| Latte | frontend/public/images/latte.jpg |
| Cold brew | frontend/public/images/cold-brew.jpg |

Ảnh JPEG rộng1200px, không logo/chữ, nền sáng và ánh sáng đồng bộ. Đây là ảnh minh họa AI cho website, không phải ảnh chụp sản phẩm thực tế của quán. Không thay giá/tồn/schema/migration/seed hoặc ghi database.

ProductImage ưu tiên URL ảnh riêng từ catalog. Nếu thiếu ảnh/đang dùng placeholder thì chọn ảnh local đúng tên món; nếu URL riêng hỏng, thử local đúng món rồi mới về SVG. Không tự gán ảnh cà phê cho một món không nhận diện được. Khi src/name đổi, trạng thái lỗi ảnh reset. Component dùng chung cho menu, chi tiết và Cart.

Catalog thực tế nằm ở database nên có thể có thêm món ngoài3 tên trong repo. Để đối chiếu đầy đủ trên máy đang chạy backend, dùng:

```powershell
(Invoke-RestMethod http://localhost:3001/products).items | Select-Object name, imageUrl
```

Các tên khác cần ảnh đúng sản phẩm và bổ sung mapping nếu imageUrl đang là placeholder. Admin có thể dùng đường dẫn ảnh local đã có; không cần chạy seed/reset để cập nhật ảnh.

## Prompt set

Built-in imagegen, use case product-mockup. Prompt chung: one photorealistic cafe menu product photo; single drink centered with margins for landscape/square crops; warm ivory plaster background, pale sandy stone tabletop, soft upper-left window light, premium editorial food photography; no people/hands/text/logo/watermark/collage/extra drinks.

- Cappuccino: rounded cream ceramic cup/saucer, thick velvety milk foam, light cocoa dusting at rim, espresso tones; slightly elevated three-quarter angle.
- Latte: tall clear glass with handle, ivory saucer, espresso and steamed milk with fine white rosetta latte art; slightly elevated three-quarter angle.
- Cold brew: straight clear tumbler, large translucent ice cubes, deep amber black coffee, condensation; no milk/cream/straw; slightly elevated three-quarter angle.

Nguồn PNG gốc do imagegen tạo được giữ riêng; JPEG dùng web được encode/nén bằng Sharp để giảm dung lượng. Không sửa package.json/lockfile.
