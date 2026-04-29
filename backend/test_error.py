import asyncio
from generator import generate_submission_document

questions = [{"heading": "Q1", "code": "print(1)"}]
async def main():
    try:
        await generate_submission_document("/tmp/test", questions, "IT123", "Name", "02")
    except Exception as e:
        import traceback
        traceback.print_exc()

asyncio.run(main())
