import httpx

from nyleg.official import check_urls, load_official_overrides, official_url


def test_official_pages_follow_the_name_pattern():
    assert official_url("senate", 401, "Liz Krueger", {}) == "https://www.nysenate.gov/senators/liz-krueger"
    assert official_url("senate", 415, "Thomas F. O'Mara", {}) == "https://www.nysenate.gov/senators/thomas-f-omara"
    assert official_url("senate", 373, "José M. Serrano", {}) == "https://www.nysenate.gov/senators/jose-m-serrano"
    assert official_url("assembly", 900, "J. Gary Pretlow", {}) == "https://nyassembly.gov/mem/J-Gary-Pretlow"


def test_senators_from_before_2009_have_no_official_page():
    assert official_url("senate", 100032, "John J. Marchi", {}) is None


def test_reviewed_fixes_win(tmp_path):
    path = tmp_path / "official-urls.yaml"
    path.write_text("- member: senate:401\n  url: null\n- member: assembly:900\n  url: https://nyassembly.gov/mem/Gary-Pretlow\n",
                    encoding="utf-8")
    overrides = load_official_overrides(path)
    assert overrides == {"senate:401": None, "assembly:900": "https://nyassembly.gov/mem/Gary-Pretlow"}
    assert official_url("senate", 401, "Liz Krueger", overrides) is None
    assert official_url("assembly", 900, "J. Gary Pretlow", overrides) == "https://nyassembly.gov/mem/Gary-Pretlow"
    assert load_official_overrides(tmp_path / "missing.yaml") == {}


def test_check_urls_reports_only_pages_that_do_not_answer_200():
    def handler(request):
        return httpx.Response(200 if request.url.path.endswith("liz-krueger") else 404)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    urls = [("Liz Krueger", "https://www.nysenate.gov/senators/liz-krueger"),
            ("Nobody", "https://www.nysenate.gov/senators/nobody")]
    assert check_urls(urls, client, sleep=lambda _: None) == [("Nobody", "https://www.nysenate.gov/senators/nobody", 404)]


def test_former_assembly_members_have_no_official_page():
    # nyassembly.gov keeps pages only for sitting members; a link to a former member's page is a 404.
    assert official_url("assembly", 1500, "Edward P. Ra", {}, current=True) == "https://nyassembly.gov/mem/Edward-P-Ra"
    assert official_url("assembly", 1501, "Zohran Kwame Mamdani", {}, current=False) is None
    assert official_url("assembly", 1501, "Zohran Kwame Mamdani", {"assembly:1501": "https://example.org"}, current=False) == "https://example.org"
