import unittest
from PIL import Image
from creative_brief import category_for_name,classify_reference,scene_prompt

class CreativeBriefTests(unittest.TestCase):
    def test_categories_are_general_and_multilingual(self):
        self.assertEqual(category_for_name("Juego de herramientas para muebles"),"herramientas")
        self.assertEqual(category_for_name("Máquina eléctrica para la cocina"),"cocina")
        self.assertEqual(category_for_name("Cargador bluetooth USB"),"tecnologia")
        self.assertEqual(category_for_name("Artículo sin clasificar"),"general")

    def test_reference_modes_do_not_claim_fidelity(self):
        self.assertEqual(classify_reference(None),"conceptual")
        self.assertEqual(classify_reference(Image.new("RGB",(100,100))),"conceptual")
        self.assertEqual(classify_reference(Image.new("RGB",(220,220))),"low_resolution_reference")
        self.assertEqual(classify_reference(Image.new("RGB",(1000,1000))),"catalog_reference")

    def test_all_variants_reserve_text_margins(self):
        for v in (1,2,3):
            for mode in ("catalog_reference","conceptual","low_resolution_reference"):
                with self.subTest(v=v,mode=mode):
                    prompt=scene_prompt("Producto para cocina",v,mode)
                    self.assertIn("AT LEAST 12% background clearance",prompt)
                    self.assertIn("ENTIRE PHYSICAL PRODUCT",prompt)
                    self.assertIn("NO writing",prompt)
                    self.assertIn("Product name",prompt)
                    self.assertNotIn("$",prompt)

    def test_no_reference_is_clearly_conceptual(self):
        prompt=scene_prompt("Producto desconocido",1,"conceptual")
        self.assertIn("NO verified reference",prompt)
        self.assertIn("CONCEPTUAL",prompt)
        self.assertIn("not an exact or verified SKU",prompt)

    def test_promotional_picture_is_not_copied_as_graphics(self):
        prompt=scene_prompt("Zapatilla",2,"catalog_reference")
        self.assertIn("marketing text",prompt)
        self.assertIn("not its original promotional background",prompt)

    def test_no_unsupported_or_overlong_title(self):
        for product,variant in (("",1),("X"*121,1),("Producto",0)):
            with self.assertRaises(ValueError):
                scene_prompt(product,variant,"conceptual")

if __name__=="__main__":
    unittest.main()
