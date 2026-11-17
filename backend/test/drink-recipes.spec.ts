import { Prisma } from '../src/generated/prisma/client';
import { drinkRecipes, inventoryRecipeForDrink, recipeAmountKey, recipeCapacity, recipeForDrink, sumRecipeAmounts, type DrinkSize } from '../src/catalog/drink-recipes';

// Keep explicit serving boundaries independent of the capacity calculation.
test.each([['S','0.009','0.150','0.005'],['M','0.018','0.220','0.010'],['L','0.018','0.300','0.015']] as const)('Latte %s keeps the restored serving quantities', (size,coffee,milk,syrup)=>{
  expect(inventoryRecipeForDrink('Latte',size)).toEqual([
    {name:'Cà phê hạt rang',unit:'KG',quantity:coffee},
    {name:'Sữa tươi không đường',unit:'L',quantity:milk},
    {name:'Syrup đường',unit:'L',quantity:syrup},
  ]);
});

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
