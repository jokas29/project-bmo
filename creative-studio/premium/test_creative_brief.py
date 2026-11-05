import unittest
from PIL import Image
from creative_brief import category_for_name,classify_reference,scene_prompt,carousel_scene_prompt

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
                    self.assertIn("AT LEAST 6% background clearance",prompt)
                    self.assertIn("ENTIRE PHYSICAL PRODUCT",prompt)
                    self.assertIn("no text",prompt)
                    self.assertIn("#E8E8E8",prompt)
                    self.assertIn("NO props",prompt)
                    self.assertIn("NO split layout",prompt)
                    self.assertLessEqual(len(prompt),2000)
                    self.assertIn("Product name",prompt)
                    self.assertNotIn("$",prompt)

    def test_carousel_usage_benefits_and_close_have_distinct_prompts(self):
        product="Máquina de ajo eléctrica"
        self.assertEqual(category_for_name(product),"cocina")
        usage=carousel_scene_prompt(product,2,"catalog_reference")
        tips=carousel_scene_prompt(product,3,"catalog_reference")
        close=carousel_scene_prompt(product,4,"catalog_reference")
        self.assertIn("LIFESTYLE PHOTO FOR SLIDE 2",usage)
        self.assertIn("real adult",usage.lower())
        self.assertIn("natural hands",usage)
        self.assertNotIn("NO props, no floating ingredients, no hands",usage)
        self.assertIn("THREE PRODUCT BENEFITS PHOTO BACKDROP FOR SLIDE 3",tips)
        self.assertIn("still-life",tips)
        self.assertNotIn("LIFESTYLE PHOTO",tips)
        self.assertIn("ENTIRE PHYSICAL PRODUCT",close)
        self.assertIn("no humans",close)
        for value in (usage,tips,close):
            self.assertLessEqual(len(value),2000)
            self.assertIn("no text",value.lower())
            self.assertNotIn("$25",value)

    def test_furniture_mover_uses_home_scene_not_generic_workshop(self):
        name = "Juego de herramientas para mover muebles"
        usage = carousel_scene_prompt(name, 2, "low_resolution_reference")
        tips = carousel_scene_prompt(name, 3, "low_resolution_reference")
        self.assertIn("furniture-moving tool", usage)
        self.assertIn("home", usage)
        self.assertIn("visible parts", usage)
        self.assertIn("do not invent casters", usage)
        self.assertNotIn("workshop bench", usage)
        self.assertIn("clean home floor", tips)
        self.assertIn("weight rating", tips)
        self.assertNotIn("workbench", tips)
        self.assertLessEqual(len(usage), 2000)
        self.assertLessEqual(len(tips), 2000)
        # Other types of tools must keep their category-specific handling.
        generic = carousel_scene_prompt("Taladro de bricolaje", 2, "catalog_reference")
        self.assertIn("workshop bench", generic)

    def test_context_prompt_remains_conceptual_without_reference(self):
        for number in (2,3,4):
            value=carousel_scene_prompt("Producto genérico",number,"conceptual")
            self.assertIn("CONCEPTUAL",value)
        for number in (0,1,5):
            with self.assertRaises(ValueError):
                carousel_scene_prompt("Producto",number,"conceptual")

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
