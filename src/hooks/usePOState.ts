import { useState, useCallback } from 'react';

export interface PurchaseOrder {
  vendor: string;
  item: string;
  quantity: number | '';
  price: number | '';
  deliveryDate: string;
}

export const usePOState = () => {
  const [poData, setPoData] = useState<PurchaseOrder>({
    vendor: '',
    item: '',
    quantity: '',
    price: '',
    deliveryDate: '',
  });

  const updateField = useCallback(<K extends keyof PurchaseOrder>(field: K, value: PurchaseOrder[K]) => {
    setPoData((prev) => ({
      ...prev,
      [field]: value,
    }));
  }, []);

  const resetPO = useCallback(() => {
    setPoData({
      vendor: '',
      item: '',
      quantity: '',
      price: '',
      deliveryDate: '',
    });
  }, []);

  return { poData, updateField, resetPO };
};
