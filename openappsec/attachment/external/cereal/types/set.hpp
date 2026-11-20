/*! \file set.hpp
    \brief Support for types found in \<set\>
    \ingroup STLSupport */

#ifndef CEREAL_TYPES_SET_HPP_
#define CEREAL_TYPES_SET_HPP_

#include <cereal/cereal.hpp>
#include <set>

namespace cereal
{
  namespace set_detail
  {
    //! @internal
    template <class Archive, class SetT> inline
    void save( Archive & ar, SetT const & set )
    {
      ar( make_size_tag( static_cast<size_type>(set.size()) ) );

      for( const auto & i : set )
        ar( i );
    }

    //! @internal
    template <class Archive, class SetT> inline
    void load( Archive & ar, SetT & set )
    {
      size_type size;
      ar( make_size_tag( size ) );

      set.clear();

      auto hint = set.begin();
      for( size_type i = 0; i < size; ++i )
      {
        typename SetT::key_type key;

        ar( key );
        #ifdef CEREAL_OLDER_GCC
        hint = set.insert( hint, std::move( key ) );
        #else // NOT CEREAL_OLDER_GCC
        hint = set.emplace_hint( hint, std::move( key ) );
        #endif // NOT CEREAL_OLDER_GCC
      }
    }
  }

  //! Saving for std::set
  template <class Archive, class K, class C, class A> inline
  void CEREAL_SAVE_FUNCTION_NAME( Archive & ar, std::set<K, C, A> const & set )
  {
    set_detail::save( ar, set );
  }

  //! Loading for std::set
  template <class Archive, class K, class C, class A> inline
  void CEREAL_LOAD_FUNCTION_NAME( Archive & ar, std::set<K, C, A> & set )
  {
    set_detail::load( ar, set );
  }

  //! Saving for std::multiset
  template <class Archive, class K, class C, class A> inline
  void CEREAL_SAVE_FUNCTION_NAME( Archive & ar, std::multiset<K, C, A> const & multiset )
  {
    set_detail::save( ar, multiset );
  }

  //! Loading for std::multiset
  template <class Archive, class K, class C, class A> inline
  void CEREAL_LOAD_FUNCTION_NAME( Archive & ar, std::multiset<K, C, A> & multiset )
  {
    set_detail::load( ar, multiset );
  }
} // namespace cereal

#endif // CEREAL_TYPES_SET_HPP_
