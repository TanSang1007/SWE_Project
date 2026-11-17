'use client';
import type { RecipeIngredientOption } from '../types/admin-product';

export type RecipeDraftLine = { key: number; ingredientId: string; amount: string };
export function ProductRecipeFields({ size, lines, ingredients, waterMl, onWaterChange, onChange, onAdd, onRemove }: {
  size: string; lines: RecipeDraftLine[]; ingredients: RecipeIngredientOption[];
  waterMl: string; onWaterChange: (value: string) => void;
  onChange: (key: number, field: 'ingredientId' | 'amount', value: string) => void;
  onAdd: () => void; onRemove: (key: number) => void;
}) {
  return <fieldset className="product-recipe" aria-describedby={`recipe-help-${size}`}>
    <legend>Công thức size {size}</legend>
    <p id={`recipe-help-${size}`}>Định lượng cho 1 ly. Nhập số nguyên dương theo g hoặc ml.</p>
    {lines.map((line, index) => {
      const selected = ingredients.find(item => item.id === line.ingredientId);
      const prefix = `recipe-${size}-${line.key}`;
      return <div className="product-recipe-line" key={line.key}>
        <div><label htmlFor={`${prefix}-ingredient`}>Nguyên liệu {index + 1}</label>
          <select id={`${prefix}-ingredient`} value={line.ingredientId} required
            onChange={event => onChange(line.key, 'ingredientId', event.target.value)}>
            <option value="">Chọn nguyên liệu</option>
            {ingredients.map(item => <option key={item.id} value={item.id}
              disabled={item.id !== line.ingredientId && lines.some(other => other.ingredientId === item.id)}>{item.name} ({item.unit})</option>)}
          </select></div>
        <div><label htmlFor={`${prefix}-amount`}>Định lượng ({selected?.unit ?? 'g/ml'})</label>
          <input id={`${prefix}-amount`} type="number" inputMode="numeric" min="1" max="999999999" step="1"
            value={line.amount} required onChange={event => onChange(line.key, 'amount', event.target.value)} /></div>
        <button type="button" disabled={lines.length <= 1} aria-label={`Xóa nguyên liệu ${index + 1} size ${size}`} onClick={() => onRemove(line.key)}>Xóa</button>
      </div>;
    })}
    <button type="button" disabled={lines.length >= ingredients.length} onClick={onAdd}>Thêm nguyên liệu size {size}</button>
    <label htmlFor={`recipe-water-${size}`}>Nước lọc (ml, không trừ kho)</label>
    <input id={`recipe-water-${size}`} name={`water-${size}`} type="number" inputMode="numeric" min="0" max="999999999" step="1" value={waterMl} onChange={event => onWaterChange(event.target.value)} />
  </fieldset>;
}
