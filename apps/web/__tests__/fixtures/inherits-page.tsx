import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/field";
import { Select } from "@/components/ui/select";

/**
 * A PAGE WRITTEN THE WAY A NEW ONE WOULD BE.
 *
 * Not one measurement, not one colour, not one shadow, not one radius —
 * only the shared components. What it looks like is the proof: if the
 * system is in the components, this inherits the whole identity without
 * asking for any of it.
 *
 * IT LIVES BESIDE THE TEST, not in the routes tree. A fixture under
 * `app/` is a page — one nobody links to, that every guard scanning
 * the segment then has to be told about. Here it is what it is.
 */
export default function InheritsPage() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Button>أساسي</Button>
        <Button variant="secondary">ثانوي</Button>
        <Button variant="danger">خطر</Button>
        <Button variant="ghost">شفاف</Button>
        <Button disabled>معطّل</Button>
        <Button isLoading>قيد التنفيذ</Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>بطاقة</CardTitle>
        </CardHeader>
        <CardBody>
          <Label htmlFor="a">حقل نصّي</Label>
          <Input id="a" />
          <Label htmlFor="b">تاريخ</Label>
          <Input id="b" type="date" appearance="chooser" />
          <Label htmlFor="c">اختيار</Label>
          <Select id="c">
            <option>خيار</option>
          </Select>
          <Label htmlFor="d">نصّ طويل</Label>
          <Textarea id="d" rows={3} />
          <Input id="e" invalid aria-label="حقل بخطأ" />
        </CardBody>
      </Card>
    </div>
  );
}
