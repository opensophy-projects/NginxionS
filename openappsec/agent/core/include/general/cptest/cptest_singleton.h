 

#ifndef __CP_TEST_SINGLETON_H__
#define __CP_TEST_SINGLETON_H__

#include "gtest/gtest.h"
#include "gmock/gmock.h"
#include "singleton.h"

// Mock objects should use Singleton::Provide<I_Face>::From<MockProvider> with the interface they mock.
template<typename I_Face>
class MockProvider : Singleton::Provide<I_Face>
{};

#endif // __CP_TEST_SINGLETON_H__

