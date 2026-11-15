import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Prisma } from '../src/generated/prisma/client';
import { drinkRecipes, inventoryRecipeForDrink, normalizeRecipeName, recipeAmountKey, recipeCapacity, recipeForDrink, sumRecipeAmounts, type DrinkSize, type RecipeAmount } from '../src/catalog/drink-recipes';

// Compare the executable quantities against the user's source files, including
// every ingredient in all 21 drink/size combinations rather than sample doses.
const sourceNames: Record<string, string> = {
  'cà phê xay thô': 'Cà phê xay thô Cold Brew',
  'nước pha espresso': 'Nước lọc', 'nước lọc để ủ': 'Nước lọc',
  'nước nóng': 'Nước lọc', 'nước lạnh': 'Nước lọc',
  'bột cacao': 'Bột cacao nguyên chất',
};
for (const size of ['S', 'M', 'L'] as const) {
  const contents = readFileSync(resolve(__dirname, '../../Size_' + size + '.txt'), 'utf8');
  const source = new Map<string, { amounts: RecipeAmount[]; invalidConversions: string[] }>();
  let drink: string | undefined;
  for (const line of contents.split(/\r?\n/)) {
    const heading = /^\d+\. (.+)$/.exec(line);
    if (heading) { drink = normalizeRecipeName(heading[1]); source.set(drink, { amounts: [], invalidConversions: [] }); continue; }
    if (line.startsWith('TOPPING')) drink = undefined;
    const dose = /^(.+?): (\d+) (g|ml)(?: \((\d+\.\d{3}) kg\))?$/.exec(line);
    if (!dose || !drink) continue;
    const quantity = new Prisma.Decimal(dose[2]).dividedBy(1000).toFixed(3);
    const recipe = source.get(drink)!;
    if (dose[3] === 'g' && dose[4] !== quantity) recipe.invalidConversions.push(line);
    const normalized = normalizeRecipeName(dose[1].replace(' (tùy chọn)', ''));
    recipe.amounts.push({ name: sourceNames[normalized] ?? dose[1].replace(' (tùy chọn)', ''),
      unit: dose[3] === 'g' ? 'KG' : 'L', quantity });
  }
  test.each([...source])('%s size ' + size + ' matches every dose in the supplied source file', (name, { amounts: expected, invalidConversions }) => {
    expect(invalidConversions).toEqual([]);
    const sort = (values: RecipeAmount[]) => values.map(item => ({ ...item, name: normalizeRecipeName(item.name) })).sort((a, b) => recipeAmountKey(a).localeCompare(recipeAmountKey(b)));
    expect(sort(recipeForDrink(name, size, [], true)!)).toEqual(sort(expected));
  });
}

test('all seven drinks have three sizes; stored spelling aliases resolve the same recipe', () => {
  expect(Object.keys(drinkRecipes)).toHaveLength(7);
  expect(recipeForDrink(' Matcha  Coldwisk ', 'M')).toEqual(recipeForDrink('MATCHA COLDWHISK', 'M'));
  expect(recipeForDrink('Cappuchino', 'S')).toEqual(recipeForDrink('Cappuccino', 'S'));
  expect(recipeForDrink('Ca cao đá', 'L')).toEqual(recipeForDrink('Cacao đá', 'L'));
  expect(recipeForDrink('Unconfigured drink', 'S')).toBeUndefined();
});
test.each(['S','M','L'] as const)('water remains in preparation size %s but never limits managed capacity',size=>{
  for(const name of Object.keys(drinkRecipes)){
    const reference=recipeForDrink(name,size)!,managed=inventoryRecipeForDrink(name,size)!;
    expect(reference.some(amount=>amount.name==='Nước lọc')).toBe(true);
    expect(managed).toEqual(reference.filter(amount=>amount.name!=='Nước lọc'));
    const balances=new Map(managed.map(amount=>[recipeAmountKey(amount),new Prisma.Decimal(amount.quantity).times(11).toFixed(3)]));
    expect(recipeCapacity(managed,balances)).toMatchObject({cups:11,status:'IN_STOCK'});
  }
});

test.each([['S', '0.020', '0.010'], ['M', '0.030', '0.015'], ['L', '0.040', '0.020']] as const)('selected toppings use size %s doses only when selected', (size: DrinkSize, cream: string, caramel: string) => {
  const base = recipeForDrink('Latte', size)!;
  expect(base.some(item => item.name === 'Kem tươi')).toBe(false);
  expect(recipeForDrink('Latte', size, ['Kem', 'Caramel'])).toEqual([...base,
    { name: 'Kem tươi', unit: 'L', quantity: cream }, { name: 'Syrup caramel', unit: 'L', quantity: caramel }]);
});

test('shared ingredients and quantities are added exactly across different drinks and sizes', () => {
  const amounts = sumRecipeAmounts([
    { amounts: recipeForDrink('Cappuccino', 'S')!, qty: 3 },
    { amounts: recipeForDrink('Latte', 'L', ['Kem'])!, qty: 2 },
  ]);
  expect(amounts.find(item => item.name === 'Cà phê hạt rang')?.quantity).toBe('0.063');
  expect(amounts.find(item => item.name === 'Sữa tươi không đường')?.quantity).toBe('0.930');
  expect(amounts.find(item => item.name === 'Kem tươi')?.quantity).toBe('0.080');
  expect(amounts.find(item => item.name === 'Bột cacao nguyên chất')?.quantity).toBe('0.003');
});

test.each([[0, 'OUT_OF_STOCK'], [1, 'LOW_STOCK'], [10, 'LOW_STOCK'], [11, 'IN_STOCK']] as const)('capacity %s uses the documented drink status boundary', (cups, status) => {
  const recipe = recipeForDrink('Matcha Coldwisk', 'M')!;
  const balances = new Map(recipe.map(item => [recipeAmountKey(item), new Prisma.Decimal(item.quantity).times(cups).toFixed(3)]));
  expect(recipeCapacity(recipe, balances)).toEqual({ cups, available: cups > 0, status });
});

test('sizes, units and topping shortages independently limit availability', () => {
  const base = recipeForDrink('Latte', 'S')!;
  const balances = new Map(base.map(item => [recipeAmountKey(item), '10.000']));
  balances.set('sữa tươi không đường|L', '0.200');
  expect(recipeCapacity(base, balances).available).toBe(true);
  expect(recipeCapacity(recipeForDrink('Latte', 'M')!, balances).available).toBe(false);
  expect(recipeCapacity(recipeForDrink('Latte', 'S', ['Kem'])!, balances).available).toBe(false);
  const wrongUnit = new Map([['sữa tươi không đường|KG', '10.000']]);
  expect(recipeCapacity(base, wrongUnit).cups).toBe(0);
});
