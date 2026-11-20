 

#ifndef __TABLE_OPAQUE_H__
#define __TABLE_OPAQUE_H__

#include "table/opaque_reg.h"

template <typename Opaque>
class TableOpaqueSerialize : public TableOpaqueReg<Opaque>
{
public:
    TableOpaqueSerialize(Opaque *ptr) : TableOpaqueReg<Opaque>(ptr) {}

    void loadOpaque(cereal::BinaryInputArchive &ar,  uint ver) override { getOpaque()->serialize(ar, ver); }
    void saveOpaque(cereal::BinaryOutputArchive &ar, uint ver) override { getOpaque()->serialize(ar, ver); }

private:
    Opaque * getOpaque() { return TableOpaqueReg<Opaque>::getOpaque(); }
};

template <typename Opaque>
class TableOpaqueLoadSave : public TableOpaqueReg<Opaque>
{
public:
    TableOpaqueLoadSave(Opaque *ptr) : TableOpaqueReg<Opaque>(ptr) {}

    void loadOpaque(cereal::BinaryInputArchive &ar,  uint ver) override { getOpaque()->load(ar, ver); }
    void saveOpaque(cereal::BinaryOutputArchive &ar, uint ver) override { getOpaque()->save(ar, ver); }

private:
    Opaque * getOpaque() { return TableOpaqueReg<Opaque>::getOpaque(); }
};

#endif // __TABLE_OPAQUE_H__
