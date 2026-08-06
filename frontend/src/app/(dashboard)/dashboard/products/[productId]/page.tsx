import { ProductFormPage } from "@/features/seller-products/components/product-form-page";

export default async function ProductDetailsRoutePage({ params }: Readonly<{ params: Promise<{ productId: string }> }>) {
  const { productId } = await params;
  return <ProductFormPage mode="edit" productId={productId} />;
}
